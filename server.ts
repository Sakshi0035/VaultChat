import http from 'http';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  pool,
  runMigrations,
  runInactiveAccountCleanup,
  deleteUserAccountCompletely,
  isDatabaseConfigured,
  getCleanupSecret,
} from './src/server/db.ts';
import {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
  generateSessionTokens,
  hashSessionToken,
  validateUsername,
  validatePassword,
  pickAvatarColor,
  AVATAR_COLORS,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  checkWindowRateLimit,
} from './src/server/security.ts';
import {
  setupWebSocketServer,
  sendToUser,
  isUserOnline,
  disconnectUserSessions,
} from './src/server/ws.ts';

dotenv.config({ quiet: true });

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE_NAME = 'vaultchat_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthenticatedUser {
  id: string;
  username: string;
  usernameNormalized: string;
  avatarColor: string;
  bio: string;
  createdAt: string;
  lastLoginAt: string;
  lastActiveAt: string;
  sessionId: string;
  csrfToken: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

function isSecureRequest(req: Request): boolean {
  return Boolean(
    req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      process.env.NODE_ENV === 'production'
  );
}

function setSessionCookie(req: Request, res: Response, rawToken: string): void {
  const secure = isSecureRequest(req);
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    maxAge: SESSION_DURATION_MS,
    path: '/',
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  const secure = isSecureRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
  });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

async function authenticateMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!isDatabaseConfigured()) {
      res.status(503).json({
        error:
          'Neon PostgreSQL database is not connected yet. Please set DATABASE_URL in the Secrets panel.',
      });
      return;
    }

    let rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    const headerToken = req.headers['x-session-token'];
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!rawToken && typeof headerToken === 'string' && headerToken.length > 10) {
      rawToken = headerToken;
    }
    if (!rawToken && queryToken && queryToken.length > 10) {
      rawToken = queryToken;
    }

    if (!rawToken || typeof rawToken !== 'string') {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    const tokenHash = hashSessionToken(rawToken);
    const result = await pool.query<{
      session_id: string;
      csrf_token: string;
      user_id: string;
      username: string;
      username_normalized: string;
      avatar_color: string;
      bio: string;
      created_at: Date;
      last_login_at: Date;
      last_active_at: Date;
    }>(
      `SELECT
         s.id AS session_id,
         s.csrf_token,
         u.id AS user_id,
         u.username,
         u.username_normalized,
         u.avatar_color,
         u.bio,
         u.created_at,
         u.last_login_at,
         u.last_active_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND u.deleted_at IS NULL`,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      return;
    }

    const row = result.rows[0];

    // CSRF Protection for state-changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      const requestedWith = req.headers['x-requested-with'];
      if (csrfHeader && csrfHeader !== row.csrf_token) {
        res.status(403).json({ error: 'Invalid security token. Please refresh and try again.' });
        return;
      }
      if (!csrfHeader && requestedWith !== 'VaultChatClient') {
        res.status(403).json({ error: 'CSRF validation failed.' });
        return;
      }
    }

    // Update last_used_at on session and last_active_at on user
    // IMPORTANT (Requirement 30): NEVER update last_login_at here!
    await pool.query(
      `UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1`,
      [row.session_id]
    );
    await pool.query(
      `UPDATE users SET last_active_at = NOW() WHERE id = $1`,
      [row.user_id]
    );

    req.user = {
      id: row.user_id,
      username: row.username,
      usernameNormalized: row.username_normalized,
      avatarColor: row.avatar_color,
      bio: row.bio,
      createdAt: row.created_at.toISOString(),
      lastLoginAt: row.last_login_at.toISOString(),
      lastActiveAt: new Date().toISOString(),
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
    };

    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  }
}

async function startServer() {
  // 1. Run database migrations on Neon PostgreSQL if DATABASE_URL is configured
  try {
    await runMigrations();
  } catch (err) {
    console.error('[Neon DB] Startup migration warning:', err);
  }

  // 2. Run initial 9-month inactive account cleanup & schedule hourly execution
  try {
    const initialCleanup = await runInactiveAccountCleanup();
    if (initialCleanup.deletedUsersCount > 0) {
      console.log(
        `[Cleanup] Purged ${initialCleanup.deletedUsersCount} accounts inactive > 9 months.`
      );
    }
  } catch (err) {
    console.error('[Cleanup] Initial cleanup run failed:', err);
  }

  setInterval(() => {
    void runInactiveAccountCleanup().catch((err) =>
      console.error('[Cleanup] Scheduled cleanup failed:', err)
    );
  }, 60 * 60 * 1000).unref();

  const app = express();
  const httpServer = http.createServer(app);

  // Attach WebSocket server on /ws
  setupWebSocketServer(httpServer);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // ==========================================================================
  // INTERNAL / SCHEDULED CRON CLEANUP ENDPOINT (Requirement 7 & 8)
  // ==========================================================================
  app.post('/api/internal/cleanup-inactive-accounts', async (req: Request, res: Response) => {
    try {
      const secretHeader =
        req.headers['x-cleanup-secret'] ||
        (typeof req.headers.authorization === 'string'
          ? req.headers.authorization.replace(/^Bearer\s+/i, '')
          : '');
      const expectedSecret = getCleanupSecret();

      if (!expectedSecret || secretHeader !== expectedSecret) {
        res.status(401).json({ error: 'Unauthorized cleanup request.' });
        return;
      }

      const result = await runInactiveAccountCleanup();
      res.json({
        success: true,
        policy: 'Accounts with last_login_at older than 9 months are permanently deleted.',
        ...result,
      });
    } catch (err) {
      console.error('[Cleanup API] Error:', err);
      res.status(500).json({ error: 'Cleanup execution failed.' });
    }
  });

  // ==========================================================================
  // AUTHENTICATION ROUTES (Requirements 1, 2, 3, 4, 5, 20, 25, 26, 30)
  // ==========================================================================

  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    try {
      if (!isDatabaseConfigured()) {
        res.status(503).json({
          error:
            'Neon PostgreSQL database is not connected yet. Please set DATABASE_URL in the Secrets panel.',
        });
        return;
      }

      const ip = getClientIp(req);
      const rateLimit = checkWindowRateLimit('signup', ip, 10, 15 * 60 * 1000);
      if (!rateLimit.allowed) {
        res.status(429).json({
          error: `Too many account creation attempts. Please wait ${rateLimit.retryAfterSeconds} seconds.`,
        });
        return;
      }

      const { username, password, confirmPassword } = req.body ?? {};

      if ('email' in (req.body ?? {})) {
        res.status(400).json({ error: 'Email is not used or supported by VaultChat.' });
        return;
      }

      const usernameCheck = validateUsername(username);
      if (!usernameCheck.valid) {
        res.status(400).json({ error: usernameCheck.error });
        return;
      }

      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        res.status(400).json({ error: passwordCheck.error });
        return;
      }

      if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
        res.status(400).json({ error: 'Passwords do not match.' });
        return;
      }

      const existing = await pool.query(
        `SELECT id FROM users WHERE username_normalized = $1 LIMIT 1`,
        [usernameCheck.normalized]
      );
      if ((existing.rowCount ?? 0) > 0) {
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const avatarColor = pickAvatarColor(usernameCheck.normalized);
      const { rawToken, tokenHash, csrfToken } = generateSessionTokens();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
      const userAgent = (req.headers['user-agent'] || '').slice(0, 255);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const userInsert = await client.query<{
          id: string;
          username: string;
          username_normalized: string;
          avatar_color: string;
          bio: string;
          created_at: Date;
          last_login_at: Date;
          last_active_at: Date;
        }>(
          `INSERT INTO users (
             username,
             username_normalized,
             password_hash,
             avatar_color,
             created_at,
             last_login_at,
             last_active_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW(), NOW())
           RETURNING id, username, username_normalized, avatar_color, bio, created_at, last_login_at, last_active_at`,
          [usernameCheck.trimmed, usernameCheck.normalized, passwordHash, avatarColor]
        );

        const newUser = userInsert.rows[0];

        await client.query(
          `INSERT INTO user_sessions (
             token_hash,
             csrf_token,
             user_id,
             user_agent,
             ip_address,
             expires_at
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tokenHash, csrfToken, newUser.id, userAgent, ip, expiresAt]
        );

        await client.query('COMMIT');

        setSessionCookie(req, res, rawToken);

        res.status(201).json({
          user: {
            username: newUser.username,
            avatarColor: newUser.avatar_color,
            bio: newUser.bio,
            createdAt: newUser.created_at.toISOString(),
            lastLoginAt: newUser.last_login_at.toISOString(),
            lastActiveAt: newUser.last_active_at.toISOString(),
          },
          csrfToken,
          sessionToken: rawToken,
        });
      } catch (dbErr: any) {
        await client.query('ROLLBACK');
        if (dbErr?.code === '23505') {
          res.status(409).json({ error: 'That username is already taken.' });
          return;
        }
        throw dbErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[Signup] Error:', err);
      res.status(500).json({ error: 'Failed to create account. Please try again.' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      if (!isDatabaseConfigured()) {
        res.status(503).json({
          error:
            'Neon PostgreSQL database is not connected yet. Please set DATABASE_URL in the Secrets panel.',
        });
        return;
      }

      const ip = getClientIp(req);
      const { username, password } = req.body ?? {};

      const normalizedInput =
        typeof username === 'string' ? username.trim().toLowerCase().slice(0, 40) : 'unknown';
      const rateKey = `${ip}:${normalizedInput}`;

      const rateCheck = await checkLoginRateLimit(rateKey);
      if (!rateCheck.allowed) {
        res.status(429).json({
          error: `Too many sign-in attempts. Please wait ${rateCheck.retryAfterSeconds} seconds before trying again.`,
        });
        return;
      }

      if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
        recordLoginFailure(rateKey);
        res.status(401).json({ error: 'Incorrect username or password.' });
        return;
      }

      const userResult = await pool.query<{
        id: string;
        username: string;
        username_normalized: string;
        password_hash: string;
        avatar_color: string;
        bio: string;
        created_at: Date;
      }>(
        `SELECT id, username, username_normalized, password_hash, avatar_color, bio, created_at
         FROM users
         WHERE username_normalized = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [normalizedInput]
      );

      if (userResult.rowCount === 0) {
        await verifyDummyPassword(password);
        recordLoginFailure(rateKey);
        res.status(401).json({ error: 'Incorrect username or password.' });
        return;
      }

      const user = userResult.rows[0];
      const passwordMatches = await verifyPassword(password, user.password_hash);
      if (!passwordMatches) {
        recordLoginFailure(rateKey);
        res.status(401).json({ error: 'Incorrect username or password.' });
        return;
      }

      clearLoginFailures(rateKey);

      const { rawToken, tokenHash, csrfToken } = generateSessionTokens();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
      const userAgent = (req.headers['user-agent'] || '').slice(0, 255);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Requirement 3 & 30: Update BOTH last_login_at and last_active_at ONLY on authenticated login
        const updatedUser = await client.query<{
          last_login_at: Date;
          last_active_at: Date;
        }>(
          `UPDATE users
           SET last_login_at = NOW(),
               last_active_at = NOW(),
               updated_at = NOW()
           WHERE id = $1
           RETURNING last_login_at, last_active_at`,
          [user.id]
        );

        await client.query(
          `INSERT INTO user_sessions (
             token_hash,
             csrf_token,
             user_id,
             user_agent,
             ip_address,
             expires_at
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tokenHash, csrfToken, user.id, userAgent, ip, expiresAt]
        );

        await client.query('COMMIT');

        setSessionCookie(req, res, rawToken);

        res.json({
          user: {
            username: user.username,
            avatarColor: user.avatar_color,
            bio: user.bio,
            createdAt: user.created_at.toISOString(),
            lastLoginAt: updatedUser.rows[0].last_login_at.toISOString(),
            lastActiveAt: updatedUser.rows[0].last_active_at.toISOString(),
          },
          csrfToken,
          sessionToken: rawToken,
        });
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[Login] Error:', err);
      res.status(500).json({ error: 'Failed to sign in. Please try again.' });
    }
  });

  app.get('/api/auth/me', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const unreadNotifications = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM notifications WHERE recipient_id = $1 AND is_read = FALSE`,
        [user.id]
      );
      const activeSessions = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [user.id]
      );

      res.json({
        user: {
          username: user.username,
          avatarColor: user.avatarColor,
          bio: user.bio,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          lastActiveAt: user.lastActiveAt,
          activeSessionsCount: parseInt(activeSessions.rows[0]?.count || '1', 10),
          unreadNotificationsCount: parseInt(unreadNotifications.rows[0]?.count || '0', 10),
        },
        csrfToken: user.csrfToken,
      });
    } catch (err) {
      console.error('[Auth Me] Error:', err);
      res.status(500).json({ error: 'Failed to load session.' });
    }
  });

  app.post('/api/auth/logout', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      await pool.query(`DELETE FROM user_sessions WHERE id = $1`, [user.sessionId]);
      clearSessionCookie(req, res);
      res.json({ success: true });
    } catch (err) {
      console.error('[Logout] Error:', err);
      res.status(500).json({ error: 'Failed to sign out.' });
    }
  });

  app.post('/api/auth/logout-all', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [user.id]);
      disconnectUserSessions(user.id);
      clearSessionCookie(req, res);
      res.json({ success: true });
    } catch (err) {
      console.error('[Logout All] Error:', err);
      res.status(500).json({ error: 'Failed to revoke sessions.' });
    }
  });

  // ==========================================================================
  // ACCOUNT, PROFILE, PASSWORD CHANGE, ACCOUNT DELETION (Requirements 16-19)
  // ==========================================================================

  app.get('/api/account/sessions', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const result = await pool.query<{
        id: string;
        user_agent: string;
        ip_address: string;
        created_at: Date;
        last_used_at: Date;
        expires_at: Date;
      }>(
        `SELECT id, user_agent, ip_address, created_at, last_used_at, expires_at
         FROM user_sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY last_used_at DESC`,
        [user.id]
      );

      res.json({
        sessions: result.rows.map((s) => ({
          id: s.id,
          userAgent: s.user_agent || 'Web Browser',
          createdAt: s.created_at.toISOString(),
          lastUsedAt: s.last_used_at.toISOString(),
          expiresAt: s.expires_at.toISOString(),
          isCurrent: s.id === user.sessionId,
        })),
      });
    } catch (err) {
      console.error('[Sessions List] Error:', err);
      res.status(500).json({ error: 'Failed to load active sessions.' });
    }
  });

  app.patch('/api/account/profile', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { username, bio, avatarColor } = req.body ?? {};

      let nextUsername = user.username;
      let nextNormalized = user.usernameNormalized;

      if (username !== undefined && username !== user.username) {
        const check = validateUsername(username);
        if (!check.valid) {
          res.status(400).json({ error: check.error });
          return;
        }
        const existing = await pool.query(
          `SELECT id FROM users WHERE username_normalized = $1 AND id <> $2 LIMIT 1`,
          [check.normalized, user.id]
        );
        if ((existing.rowCount ?? 0) > 0) {
          res.status(409).json({ error: 'That username is already taken.' });
          return;
        }
        nextUsername = check.trimmed;
        nextNormalized = check.normalized;
      }

      const nextBio =
        typeof bio === 'string' ? bio.trim().slice(0, 160) : user.bio;
      const nextColor =
        typeof avatarColor === 'string' && AVATAR_COLORS.includes(avatarColor)
          ? avatarColor
          : user.avatarColor;

      const updated = await pool.query<{
        username: string;
        avatar_color: string;
        bio: string;
        created_at: Date;
        last_login_at: Date;
        last_active_at: Date;
      }>(
        `UPDATE users
         SET username = $1,
             username_normalized = $2,
             bio = $3,
             avatar_color = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING username, avatar_color, bio, created_at, last_login_at, last_active_at`,
        [nextUsername, nextNormalized, nextBio, nextColor, user.id]
      );

      const row = updated.rows[0];
      res.json({
        user: {
          username: row.username,
          avatarColor: row.avatar_color,
          bio: row.bio,
          createdAt: row.created_at.toISOString(),
          lastLoginAt: row.last_login_at.toISOString(),
          lastActiveAt: row.last_active_at.toISOString(),
        },
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
      console.error('[Update Profile] Error:', err);
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  app.post('/api/account/change-password', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { currentPassword, newPassword, confirmNewPassword } = req.body ?? {};

      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ error: 'Current password is required.' });
        return;
      }

      const pwdCheck = validatePassword(newPassword);
      if (!pwdCheck.valid) {
        res.status(400).json({ error: pwdCheck.error });
        return;
      }

      if (newPassword !== confirmNewPassword) {
        res.status(400).json({ error: 'New passwords do not match.' });
        return;
      }

      const userRow = await pool.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
        [user.id]
      );
      if (userRow.rowCount === 0) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      const isCurrentValid = await verifyPassword(currentPassword, userRow.rows[0].password_hash);
      if (!isCurrentValid) {
        res.status(401).json({ error: 'Current password is incorrect.' });
        return;
      }

      const newHash = await hashPassword(newPassword);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
          [newHash, user.id]
        );
        await client.query(`DELETE FROM user_sessions WHERE user_id = $1`, [user.id]);
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }

      disconnectUserSessions(user.id);
      clearSessionCookie(req, res);

      res.json({
        success: true,
        message: 'Password updated successfully. Please sign in with your new password.',
      });
    } catch (err) {
      console.error('[Change Password] Error:', err);
      res.status(500).json({ error: 'Failed to change password.' });
    }
  });

  app.post('/api/account/delete', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { currentPassword } = req.body ?? {};

      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ error: 'Current password is required to delete your account.' });
        return;
      }

      const userRow = await pool.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
        [user.id]
      );
      if (userRow.rowCount === 0) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      const isCurrentValid = await verifyPassword(currentPassword, userRow.rows[0].password_hash);
      if (!isCurrentValid) {
        res.status(401).json({ error: 'Current password is incorrect.' });
        return;
      }

      disconnectUserSessions(user.id);
      await deleteUserAccountCompletely(user.id);
      clearSessionCookie(req, res);

      res.json({
        success: true,
        message: 'Your account and all associated data have been permanently deleted.',
      });
    } catch (err) {
      console.error('[Delete Account] Error:', err);
      res.status(500).json({ error: 'Failed to delete account.' });
    }
  });

  // ==========================================================================
  // USERNAME SEARCH & PUBLIC PROFILES (Requirement 10)
  // Never expose email, password, password_hash, or internal database ID!
  // ==========================================================================

  app.get('/api/users/search', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const cleanQuery = rawQuery.replace(/^@/, '').toLowerCase();

      if (!cleanQuery) {
        res.json({ users: [] });
        return;
      }

      const escaped = cleanQuery.replace(/[%_\\]/g, '\\$&');

      const result = await pool.query<{
        id: string;
        username: string;
        avatar_color: string;
        bio: string;
        created_at: Date;
        is_blocked_by_me: boolean;
        has_blocked_me: boolean;
        existing_conversation_id: string | null;
        existing_conversation_status: string | null;
      }>(
        `SELECT
           u.id,
           u.username,
           u.avatar_color,
           u.bio,
           u.created_at,
           EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE b.blocker_id = $1 AND b.blocked_id = u.id
           ) AS is_blocked_by_me,
           EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE b.blocker_id = u.id AND b.blocked_id = $1
           ) AS has_blocked_me,
           (
             SELECT c.id
             FROM conversations c
             JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
             JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = u.id
             LIMIT 1
           ) AS existing_conversation_id,
           (
             SELECT c.status
             FROM conversations c
             JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
             JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = u.id
             LIMIT 1
           ) AS existing_conversation_status
         FROM users u
         WHERE u.id <> $1
           AND u.deleted_at IS NULL
           AND u.username_normalized LIKE $2 ESCAPE '\\'
         ORDER BY
           CASE WHEN u.username_normalized = $3 THEN 0
                WHEN u.username_normalized LIKE $4 ESCAPE '\\' THEN 1
                ELSE 2
           END,
           u.username_normalized ASC
         LIMIT 20`,
        [user.id, `%${escaped}%`, cleanQuery, `${escaped}%`]
      );

      const users = result.rows.map((r) => ({
        username: r.username,
        avatarColor: r.avatar_color,
        bio: r.bio,
        createdAt: r.created_at.toISOString(),
        isOnline: !r.is_blocked_by_me && !r.has_blocked_me ? isUserOnline(r.id) : false,
        isBlockedByMe: r.is_blocked_by_me,
        hasBlockedMe: r.has_blocked_me,
        existingConversationId: r.existing_conversation_id,
        existingConversationStatus: r.existing_conversation_status,
      }));

      res.json({ users });
    } catch (err) {
      console.error('[Search Users] Error:', err);
      res.status(500).json({ error: 'Failed to search users.' });
    }
  });

  app.get('/api/users/profile/:username', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const targetNormalized = (req.params.username || '').trim().replace(/^@/, '').toLowerCase();
      if (!targetNormalized) {
        res.status(400).json({ error: 'Username is required.' });
        return;
      }

      const result = await pool.query<{
        id: string;
        username: string;
        avatar_color: string;
        bio: string;
        created_at: Date;
        is_blocked_by_me: boolean;
        has_blocked_me: boolean;
      }>(
        `SELECT
           u.id,
           u.username,
           u.avatar_color,
           u.bio,
           u.created_at,
           EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE b.blocker_id = $1 AND b.blocked_id = u.id
           ) AS is_blocked_by_me,
           EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE b.blocker_id = u.id AND b.blocked_id = $1
           ) AS has_blocked_me
         FROM users u
         WHERE u.username_normalized = $2 AND u.deleted_at IS NULL
         LIMIT 1`,
        [user.id, targetNormalized]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const row = result.rows[0];
      res.json({
        profile: {
          username: row.username,
          avatarColor: row.avatar_color,
          bio: row.bio,
          createdAt: row.created_at.toISOString(),
          isOnline: !row.is_blocked_by_me && !row.has_blocked_me ? isUserOnline(row.id) : false,
          isBlockedByMe: row.is_blocked_by_me,
          hasBlockedMe: row.has_blocked_me,
        },
      });
    } catch (err) {
      console.error('[Public Profile] Error:', err);
      res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  // ==========================================================================
  // CHATS BUCKET STORAGE ENDPOINT (Serving attachments from bucket 'chats')
  // ==========================================================================

  app.get('/api/storage/chats/:attachmentId', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { attachmentId } = req.params;
      if (!isValidUuid(attachmentId)) {
        res.status(400).json({ error: 'Invalid attachment ID.' });
        return;
      }

      const result = await pool.query<{
        file_name: string;
        mime_type: string;
        data_base64: string;
      }>(
        `SELECT a.file_name, a.mime_type, a.data_base64
         FROM chat_attachments a
         JOIN conversation_members cm ON cm.conversation_id = a.conversation_id AND cm.user_id = $1
         JOIN messages m ON m.id = a.message_id AND m.deleted_at IS NULL
         WHERE a.id = $2 AND a.bucket_name = 'chats'
         LIMIT 1`,
        [user.id, attachmentId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Attachment not found or access denied.' });
        return;
      }

      const row = result.rows[0];
      const buffer = Buffer.from(row.data_base64, 'base64');
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(row.file_name)}"`
      );
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (err) {
      console.error('[Chats Storage Bucket] Error:', err);
      res.status(500).json({ error: 'Failed to retrieve attachment.' });
    }
  });

  // ==========================================================================
  // CONVERSATIONS & MESSAGE REQUESTS (Requirements 9, 11, 12, 32, 34)
  // ==========================================================================

  app.get('/api/conversations', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;

      const result = await pool.query<{
        conversation_id: string;
        status: string;
        initiated_by: string | null;
        created_at: Date;
        updated_at: Date;
        my_last_read_at: Date;
        peer_id: string;
        peer_username: string;
        peer_avatar_color: string;
        peer_bio: string;
        peer_created_at: Date;
        peer_last_active_at: Date;
        is_blocked_by_me: boolean;
        has_blocked_me: boolean;
        last_msg_id: string | null;
        last_msg_sender_id: string | null;
        last_msg_sender_username: string | null;
        last_msg_body: string | null;
        last_msg_created_at: Date | null;
        last_msg_edited_at: Date | null;
        last_msg_deleted_at: Date | null;
        last_msg_read_by_peer: boolean | null;
        unread_count: string;
      }>(
        `SELECT
           c.id AS conversation_id,
           c.status,
           c.initiated_by,
           c.created_at,
           c.updated_at,
           cm_me.last_read_at AS my_last_read_at,
           u_peer.id AS peer_id,
           u_peer.username AS peer_username,
           u_peer.avatar_color AS peer_avatar_color,
           u_peer.bio AS peer_bio,
           u_peer.created_at AS peer_created_at,
           u_peer.last_active_at AS peer_last_active_at,
           EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE b.blocker_id = $1 AND b.blocked_id = u_peer.id
           ) AS is_blocked_by_me,
           EXISTS (
             SELECT 1 FROM user_blocks b
             WHERE b.blocker_id = u_peer.id AND b.blocked_id = $1
           ) AS has_blocked_me,
           lm.id AS last_msg_id,
           lm.sender_id AS last_msg_sender_id,
           lm.sender_username AS last_msg_sender_username,
           lm.body AS last_msg_body,
           lm.created_at AS last_msg_created_at,
           lm.edited_at AS last_msg_edited_at,
           lm.deleted_at AS last_msg_deleted_at,
           lm.read_by_peer AS last_msg_read_by_peer,
           (
             SELECT COUNT(*)::text
             FROM messages m_unr
             LEFT JOIN message_reads mr ON mr.message_id = m_unr.id AND mr.user_id = $1
             WHERE m_unr.conversation_id = c.id
               AND m_unr.sender_id <> $1
               AND m_unr.deleted_at IS NULL
               AND mr.message_id IS NULL
           ) AS unread_count
         FROM conversations c
         JOIN conversation_members cm_me
           ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
         JOIN conversation_members cm_peer
           ON cm_peer.conversation_id = c.id AND cm_peer.user_id <> $1
         JOIN users u_peer
           ON u_peer.id = cm_peer.user_id AND u_peer.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT
             m.id,
             m.sender_id,
             u_s.username AS sender_username,
             m.body,
             m.created_at,
             m.edited_at,
             m.deleted_at,
             EXISTS (
               SELECT 1 FROM message_reads mr_p
               WHERE mr_p.message_id = m.id AND mr_p.user_id = u_peer.id
             ) AS read_by_peer
           FROM messages m
           JOIN users u_s ON u_s.id = m.sender_id
           WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) lm ON TRUE
         WHERE c.status <> 'declined'
         ORDER BY COALESCE(lm.created_at, c.updated_at) DESC`,
        [user.id]
      );

      const conversations = result.rows.map((row) => {
        const blockedEitherWay = row.is_blocked_by_me || row.has_blocked_me;
        return {
          id: row.conversation_id,
          status: row.status as 'pending' | 'active',
          isInitiatedByMe: row.initiated_by === user.id,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          unreadCount: parseInt(row.unread_count || '0', 10),
          peer: {
            username: row.peer_username,
            avatarColor: row.peer_avatar_color,
            bio: row.peer_bio,
            createdAt: row.peer_created_at.toISOString(),
            isOnline: !blockedEitherWay ? isUserOnline(row.peer_id) : false,
            lastActiveAt: !blockedEitherWay ? row.peer_last_active_at.toISOString() : null,
            isBlockedByMe: row.is_blocked_by_me,
            hasBlockedMe: row.has_blocked_me,
          },
          lastMessage: row.last_msg_id
            ? {
                id: row.last_msg_id,
                senderUsername: row.last_msg_sender_username!,
                isMine: row.last_msg_sender_id === user.id,
                body: row.last_msg_deleted_at ? '' : row.last_msg_body || '',
                isDeleted: Boolean(row.last_msg_deleted_at),
                createdAt: row.last_msg_created_at!.toISOString(),
                editedAt: row.last_msg_edited_at ? row.last_msg_edited_at.toISOString() : null,
                isReadByPeer: Boolean(row.last_msg_read_by_peer),
              }
            : null,
        };
      });

      res.json({ conversations });
    } catch (err) {
      console.error('[Get Conversations] Error:', err);
      res.status(500).json({ error: 'Failed to load conversations.' });
    }
  });

  app.post('/api/conversations', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { username, initialMessage } = req.body ?? {};

      const targetNormalized =
        typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';
      if (!targetNormalized) {
        res.status(400).json({ error: 'Target username is required.' });
        return;
      }

      if (targetNormalized === user.usernameNormalized) {
        res.status(400).json({ error: 'You cannot start a conversation with yourself.' });
        return;
      }

      const peerResult = await pool.query<{
        id: string;
        username: string;
        avatar_color: string;
        bio: string;
        created_at: Date;
        last_active_at: Date;
      }>(
        `SELECT id, username, avatar_color, bio, created_at, last_active_at
         FROM users
         WHERE username_normalized = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [targetNormalized]
      );

      if (peerResult.rowCount === 0) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const peer = peerResult.rows[0];

      const blockResult = await pool.query<{ blocker_id: string }>(
        `SELECT blocker_id FROM user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [user.id, peer.id]
      );

      if ((blockResult.rowCount ?? 0) > 0) {
        const blockedByMe = blockResult.rows[0].blocker_id === user.id;
        res.status(403).json({
          error: blockedByMe
            ? `You have blocked @${peer.username}. Unblock them first to start a conversation.`
            : `You cannot start a conversation with @${peer.username}.`,
        });
        return;
      }

      const existingConv = await pool.query<{
        id: string;
        status: string;
        initiated_by: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT c.id, c.status, c.initiated_by, c.created_at, c.updated_at
         FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = $1
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = $2
         LIMIT 1`,
        [user.id, peer.id]
      );

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let conversationId: string;
        let status: 'pending' | 'active';
        let initiatedBy: string | null;
        let createdAt: Date;
        let updatedAt: Date;
        let isNewConversation = false;

        if ((existingConv.rowCount ?? 0) > 0) {
          const conv = existingConv.rows[0];
          conversationId = conv.id;
          createdAt = conv.created_at;
          updatedAt = conv.updated_at;
          initiatedBy = conv.initiated_by;

          if (conv.status === 'declined') {
            const reopened = await client.query<{ updated_at: Date }>(
              `UPDATE conversations
               SET status = 'pending', initiated_by = $1, updated_at = NOW()
               WHERE id = $2
               RETURNING updated_at`,
              [user.id, conversationId]
            );
            status = 'pending';
            initiatedBy = user.id;
            updatedAt = reopened.rows[0].updated_at;
          } else if (conv.status === 'pending' && conv.initiated_by === peer.id) {
            const accepted = await client.query<{ updated_at: Date }>(
              `UPDATE conversations
               SET status = 'active', updated_at = NOW()
               WHERE id = $1
               RETURNING updated_at`,
              [conversationId]
            );
            status = 'active';
            updatedAt = accepted.rows[0].updated_at;
          } else {
            status = conv.status as 'pending' | 'active';
          }
        } else {
          isNewConversation = true;
          const convInsert = await client.query<{
            id: string;
            status: string;
            initiated_by: string;
            created_at: Date;
            updated_at: Date;
          }>(
            `INSERT INTO conversations (status, initiated_by, created_at, updated_at)
             VALUES ('pending', $1, NOW(), NOW())
             RETURNING id, status, initiated_by, created_at, updated_at`,
            [user.id]
          );
          const conv = convInsert.rows[0];
          conversationId = conv.id;
          status = 'pending';
          initiatedBy = conv.initiated_by;
          createdAt = conv.created_at;
          updatedAt = conv.updated_at;

          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_at)
             VALUES ($1, $2, NOW(), NOW()), ($1, $3, NOW(), NOW())`,
            [conversationId, user.id, peer.id]
          );

          const notifRes = await client.query<{
            id: string;
            type: string;
            title: string;
            body: string;
            is_read: boolean;
            created_at: Date;
          }>(
            `INSERT INTO notifications (recipient_id, actor_id, conversation_id, type, title, body)
             VALUES ($1, $2, $3, 'message_request', $4, $5)
             RETURNING id, type, title, body, is_read, created_at`,
            [
              peer.id,
              user.id,
              conversationId,
              `New message request from @${user.username}`,
              typeof initialMessage === 'string' && initialMessage.trim()
                ? initialMessage.trim().slice(0, 120)
                : `@${user.username} wants to chat with you.`,
            ]
          );

          sendToUser(peer.id, 'notification:new', {
            id: notifRes.rows[0].id,
            type: notifRes.rows[0].type,
            title: notifRes.rows[0].title,
            body: notifRes.rows[0].body,
            conversationId,
            actorUsername: user.username,
            isRead: false,
            createdAt: notifRes.rows[0].created_at.toISOString(),
          });
        }

        let createdMsg: any = null;
        if (typeof initialMessage === 'string' && initialMessage.trim()) {
          const cleanBody = initialMessage.trim().slice(0, 4000);
          const msgInsert = await client.query<{
            id: string;
            body: string;
            created_at: Date;
          }>(
            `INSERT INTO messages (conversation_id, sender_id, body, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, body, created_at`,
            [conversationId, user.id, cleanBody]
          );
          const m = msgInsert.rows[0];
          await client.query(
            `INSERT INTO message_reads (message_id, user_id, read_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT DO NOTHING`,
            [m.id, user.id]
          );
          await client.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [
            conversationId,
          ]);
          createdMsg = {
            id: m.id,
            conversationId,
            senderUsername: user.username,
            isMine: true,
            body: m.body,
            isDeleted: false,
            replyTo: null,
            attachment: null,
            createdAt: m.created_at.toISOString(),
            editedAt: null,
            isReadByPeer: false,
          };
        }

        await client.query('COMMIT');

        if (isNewConversation || createdMsg) {
          sendToUser(peer.id, 'conversation:updated', { conversationId });
          if (createdMsg) {
            sendToUser(peer.id, 'message:new', {
              ...createdMsg,
              isMine: false,
            });
          }
        }

        res.status(isNewConversation ? 201 : 200).json({
          conversation: {
            id: conversationId,
            status,
            isInitiatedByMe: initiatedBy === user.id,
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
            unreadCount: 0,
            peer: {
              username: peer.username,
              avatarColor: peer.avatar_color,
              bio: peer.bio,
              createdAt: peer.created_at.toISOString(),
              isOnline: isUserOnline(peer.id),
              lastActiveAt: peer.last_active_at.toISOString(),
              isBlockedByMe: false,
              hasBlockedMe: false,
            },
            lastMessage: createdMsg,
          },
        });
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[Create Conversation] Error:', err);
      res.status(500).json({ error: 'Failed to start conversation.' });
    }
  });

  app.post('/api/conversations/:id/accept', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const conversationId = req.params.id;
      if (!isValidUuid(conversationId)) {
        res.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }

      const memberCheck = await pool.query<{
        status: string;
        initiated_by: string | null;
        peer_id: string;
      }>(
        `SELECT c.status, c.initiated_by, cm_peer.user_id AS peer_id
         FROM conversations c
         JOIN conversation_members cm_me ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
         JOIN conversation_members cm_peer ON cm_peer.conversation_id = c.id AND cm_peer.user_id <> $1
         WHERE c.id = $2
         LIMIT 1`,
        [user.id, conversationId]
      );

      if (memberCheck.rowCount === 0) {
        res.status(403).json({ error: 'Access denied to this conversation.' });
        return;
      }

      const { peer_id } = memberCheck.rows[0];

      await pool.query(
        `UPDATE conversations SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );

      const notifRes = await pool.query<{
        id: string;
        type: string;
        title: string;
        body: string;
        created_at: Date;
      }>(
        `INSERT INTO notifications (recipient_id, actor_id, conversation_id, type, title, body)
         VALUES ($1, $2, $3, 'request_accepted', $4, $5)
         RETURNING id, type, title, body, created_at`,
        [
          peer_id,
          user.id,
          conversationId,
          `Message request accepted`,
          `@${user.username} accepted your message request.`,
        ]
      );

      sendToUser(peer_id, 'conversation:updated', { conversationId, status: 'active' });
      sendToUser(peer_id, 'notification:new', {
        id: notifRes.rows[0].id,
        type: notifRes.rows[0].type,
        title: notifRes.rows[0].title,
        body: notifRes.rows[0].body,
        conversationId,
        actorUsername: user.username,
        isRead: false,
        createdAt: notifRes.rows[0].created_at.toISOString(),
      });

      res.json({ success: true, status: 'active' });
    } catch (err) {
      console.error('[Accept Conversation] Error:', err);
      res.status(500).json({ error: 'Failed to accept message request.' });
    }
  });

  app.post('/api/conversations/:id/decline', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const conversationId = req.params.id;
      if (!isValidUuid(conversationId)) {
        res.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }

      const memberCheck = await pool.query<{ peer_id: string }>(
        `SELECT cm_peer.user_id AS peer_id
         FROM conversations c
         JOIN conversation_members cm_me ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
         JOIN conversation_members cm_peer ON cm_peer.conversation_id = c.id AND cm_peer.user_id <> $1
         WHERE c.id = $2
         LIMIT 1`,
        [user.id, conversationId]
      );

      if (memberCheck.rowCount === 0) {
        res.status(403).json({ error: 'Access denied to this conversation.' });
        return;
      }

      await pool.query(
        `UPDATE conversations SET status = 'declined', updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );

      sendToUser(memberCheck.rows[0].peer_id, 'conversation:updated', {
        conversationId,
        status: 'declined',
      });

      res.json({ success: true, status: 'declined' });
    } catch (err) {
      console.error('[Decline Conversation] Error:', err);
      res.status(500).json({ error: 'Failed to decline message request.' });
    }
  });

  // ==========================================================================
  // MESSAGES ROUTES (Requirements 11, 12, 13, 32, 37 + 'chats' bucket attachments)
  // ==========================================================================

  app.get('/api/conversations/:id/messages', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const conversationId = req.params.id;
      if (!isValidUuid(conversationId)) {
        res.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }

      const authCheck = await pool.query<{ peer_id: string; status: string }>(
        `SELECT cm_peer.user_id AS peer_id, c.status
         FROM conversations c
         JOIN conversation_members cm_me ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
         JOIN conversation_members cm_peer ON cm_peer.conversation_id = c.id AND cm_peer.user_id <> $1
         WHERE c.id = $2
         LIMIT 1`,
        [user.id, conversationId]
      );

      if (authCheck.rowCount === 0) {
        res.status(403).json({ error: 'You are not authorized to view this conversation.' });
        return;
      }

      const { peer_id } = authCheck.rows[0];
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
      const before = typeof req.query.before === 'string' ? req.query.before : null;
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

      const newlyRead = await pool.query<{ id: string }>(
        `INSERT INTO message_reads (message_id, user_id, read_at)
         SELECT m.id, $1, NOW()
         FROM messages m
         LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = $1
         WHERE m.conversation_id = $2
           AND m.sender_id <> $1
           AND mr.message_id IS NULL
         ON CONFLICT DO NOTHING
         RETURNING message_id AS id`,
        [user.id, conversationId]
      );

      if ((newlyRead.rowCount ?? 0) > 0) {
        await pool.query(
          `UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, user.id]
        );
        sendToUser(peer_id, 'message:read', {
          conversationId,
          readByUsername: user.username,
          readAt: new Date().toISOString(),
        });
      }

      const params: any[] = [conversationId, peer_id];
      let filterSql = '';

      if (before) {
        params.push(before);
        filterSql += ` AND m.created_at < $${params.length}`;
      }

      if (search) {
        const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
        params.push(`%${escapedSearch}%`);
        filterSql += ` AND m.deleted_at IS NULL AND m.body ILIKE $${params.length} ESCAPE '\\'`;
      }

      params.push(limit);

      const messagesRes = await pool.query<{
        id: string;
        conversation_id: string;
        sender_id: string;
        sender_username: string;
        body: string;
        created_at: Date;
        edited_at: Date | null;
        deleted_at: Date | null;
        reply_to_id: string | null;
        reply_to_body: string | null;
        reply_to_deleted_at: Date | null;
        reply_to_sender_username: string | null;
        att_id: string | null;
        att_bucket: string | null;
        att_file_name: string | null;
        att_mime_type: string | null;
        att_size_bytes: number | null;
        is_read_by_peer: boolean;
      }>(
        `SELECT
           m.id,
           m.conversation_id,
           m.sender_id,
           u_s.username AS sender_username,
           m.body,
           m.created_at,
           m.edited_at,
           m.deleted_at,
           m.reply_to_id,
           m_rep.body AS reply_to_body,
           m_rep.deleted_at AS reply_to_deleted_at,
           u_rep.username AS reply_to_sender_username,
           att.id AS att_id,
           att.bucket_name AS att_bucket,
           att.file_name AS att_file_name,
           att.mime_type AS att_mime_type,
           att.size_bytes AS att_size_bytes,
           EXISTS (
             SELECT 1 FROM message_reads mr
             WHERE mr.message_id = m.id AND mr.user_id = $2
           ) AS is_read_by_peer
         FROM messages m
         JOIN users u_s ON u_s.id = m.sender_id
         LEFT JOIN messages m_rep ON m_rep.id = m.reply_to_id
         LEFT JOIN users u_rep ON u_rep.id = m_rep.sender_id
         LEFT JOIN LATERAL (
           SELECT id, bucket_name, file_name, mime_type, size_bytes
           FROM chat_attachments ca
           WHERE ca.message_id = m.id
           LIMIT 1
         ) att ON TRUE
         WHERE m.conversation_id = $1
           ${filterSql}
         ORDER BY m.created_at DESC
         LIMIT $${params.length}`,
        params
      );

      const messages = messagesRes.rows.reverse().map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderUsername: m.sender_username,
        isMine: m.sender_id === user.id,
        body: m.deleted_at ? '' : m.body,
        isDeleted: Boolean(m.deleted_at),
        replyTo: m.reply_to_id
          ? {
              id: m.reply_to_id,
              senderUsername: m.reply_to_sender_username || 'User',
              body: m.reply_to_deleted_at ? 'Message deleted' : m.reply_to_body || '',
            }
          : null,
        attachment:
          !m.deleted_at && m.att_id
            ? {
                id: m.att_id,
                bucket: m.att_bucket || 'chats',
                fileName: m.att_file_name || 'attachment',
                mimeType: m.att_mime_type || 'application/octet-stream',
                sizeBytes: m.att_size_bytes || 0,
              }
            : null,
        createdAt: m.created_at.toISOString(),
        editedAt: m.edited_at ? m.edited_at.toISOString() : null,
        isReadByPeer: m.is_read_by_peer,
      }));

      res.json({
        messages,
        hasMore: messagesRes.rows.length === limit,
      });
    } catch (err) {
      console.error('[Get Messages] Error:', err);
      res.status(500).json({ error: 'Failed to load messages.' });
    }
  });

  app.post('/api/conversations/:id/messages', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const conversationId = req.params.id;
      if (!isValidUuid(conversationId)) {
        res.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }

      const rateLimit = checkWindowRateLimit('message', user.id, 45, 60 * 1000);
      if (!rateLimit.allowed) {
        res.status(429).json({
          error: `You are sending messages too quickly. Please wait ${rateLimit.retryAfterSeconds} seconds.`,
        });
        return;
      }

      const { body, replyToId, attachment } = req.body ?? {};
      const hasAttachment =
        attachment &&
        typeof attachment.fileName === 'string' &&
        typeof attachment.mimeType === 'string' &&
        typeof attachment.dataBase64 === 'string' &&
        attachment.dataBase64.length > 0;

      const rawBody = typeof body === 'string' ? body.trim() : '';
      if (!rawBody && !hasAttachment) {
        res.status(400).json({ error: 'Message body or attachment is required.' });
        return;
      }

      const cleanBody = rawBody || (hasAttachment ? `Shared ${attachment.fileName}` : '');
      if (cleanBody.length > 4000) {
        res.status(400).json({ error: 'Message cannot exceed 4,000 characters.' });
        return;
      }

      const convCheck = await pool.query<{
        status: string;
        initiated_by: string | null;
        peer_id: string;
        peer_username: string;
      }>(
        `SELECT
           c.status,
           c.initiated_by,
           u_peer.id AS peer_id,
           u_peer.username AS peer_username
         FROM conversations c
         JOIN conversation_members cm_me ON cm_me.conversation_id = c.id AND cm_me.user_id = $1
         JOIN conversation_members cm_peer ON cm_peer.conversation_id = c.id AND cm_peer.user_id <> $1
         JOIN users u_peer ON u_peer.id = cm_peer.user_id AND u_peer.deleted_at IS NULL
         WHERE c.id = $2
         LIMIT 1`,
        [user.id, conversationId]
      );

      if (convCheck.rowCount === 0) {
        res.status(403).json({ error: 'You are not authorized to send messages in this conversation.' });
        return;
      }

      const { status, initiated_by, peer_id, peer_username } = convCheck.rows[0];

      const blockRes = await pool.query<{ blocker_id: string }>(
        `SELECT blocker_id FROM user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [user.id, peer_id]
      );

      if ((blockRes.rowCount ?? 0) > 0) {
        const isBlockedByMe = blockRes.rows[0].blocker_id === user.id;
        res.status(403).json({
          error: isBlockedByMe
            ? `You have blocked @${peer_username}. Unblock them to send messages.`
            : `You cannot send messages to @${peer_username}.`,
        });
        return;
      }

      let validReplyToId: string | null = null;
      let replyPreview: { id: string; senderUsername: string; body: string } | null = null;

      if (replyToId && isValidUuid(replyToId)) {
        const repRes = await pool.query<{
          id: string;
          body: string;
          deleted_at: Date | null;
          sender_username: string;
        }>(
          `SELECT m.id, m.body, m.deleted_at, u.username AS sender_username
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.id = $1 AND m.conversation_id = $2
           LIMIT 1`,
          [replyToId, conversationId]
        );
        if ((repRes.rowCount ?? 0) > 0) {
          const r = repRes.rows[0];
          validReplyToId = r.id;
          replyPreview = {
            id: r.id,
            senderUsername: r.sender_username,
            body: r.deleted_at ? 'Message deleted' : r.body,
          };
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let nextStatus = status;
        if (status === 'pending' && initiated_by && initiated_by !== user.id) {
          nextStatus = 'active';
        } else if (status === 'declined') {
          nextStatus = 'pending';
        }

        const msgInsert = await client.query<{
          id: string;
          created_at: Date;
        }>(
          `INSERT INTO messages (conversation_id, sender_id, reply_to_id, body, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id, created_at`,
          [conversationId, user.id, validReplyToId, cleanBody]
        );

        const newMsg = msgInsert.rows[0];

        let savedAttachment: {
          id: string;
          bucket: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
        } | null = null;

        if (hasAttachment) {
          const cleanBase64 = String(attachment.dataBase64).replace(/^data:[^;]+;base64,/, '');
          const sizeBytes = Math.ceil((cleanBase64.length * 3) / 4);
          if (sizeBytes > 5 * 1024 * 1024) {
            throw new Error('Attachment size cannot exceed 5 MB.');
          }
          const attInsert = await client.query<{
            id: string;
            bucket_name: string;
            file_name: string;
            mime_type: string;
            size_bytes: number;
          }>(
            `INSERT INTO chat_attachments (
               bucket_name,
               conversation_id,
               message_id,
               uploader_id,
               file_name,
               mime_type,
               size_bytes,
               data_base64
             )
             VALUES ('chats', $1, $2, $3, $4, $5, $6, $7)
             RETURNING id, bucket_name, file_name, mime_type, size_bytes`,
            [
              conversationId,
              newMsg.id,
              user.id,
              String(attachment.fileName).slice(0, 255),
              String(attachment.mimeType).slice(0, 120),
              sizeBytes,
              cleanBase64,
            ]
          );
          const a = attInsert.rows[0];
          savedAttachment = {
            id: a.id,
            bucket: a.bucket_name,
            fileName: a.file_name,
            mimeType: a.mime_type,
            sizeBytes: a.size_bytes,
          };
        }

        await client.query(
          `INSERT INTO message_reads (message_id, user_id, read_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [newMsg.id, user.id]
        );

        await client.query(
          `UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2`,
          [nextStatus, conversationId]
        );

        await client.query(
          `UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, user.id]
        );

        const notifInsert = await client.query<{
          id: string;
          type: string;
          title: string;
          body: string;
          created_at: Date;
        }>(
          `INSERT INTO notifications (recipient_id, actor_id, conversation_id, type, title, body)
           VALUES ($1, $2, $3, 'new_message', $4, $5)
           RETURNING id, type, title, body, created_at`,
          [
            peer_id,
            user.id,
            conversationId,
            `New message from @${user.username}`,
            cleanBody.slice(0, 120),
          ]
        );

        await client.query('COMMIT');

        const messagePayload = {
          id: newMsg.id,
          conversationId,
          senderUsername: user.username,
          isMine: true,
          body: cleanBody,
          isDeleted: false,
          replyTo: replyPreview,
          attachment: savedAttachment,
          createdAt: newMsg.created_at.toISOString(),
          editedAt: null,
          isReadByPeer: false,
        };

        sendToUser(peer_id, 'message:new', {
          ...messagePayload,
          isMine: false,
        });

        sendToUser(peer_id, 'notification:new', {
          id: notifInsert.rows[0].id,
          type: notifInsert.rows[0].type,
          title: notifInsert.rows[0].title,
          body: notifInsert.rows[0].body,
          conversationId,
          actorUsername: user.username,
          isRead: false,
          createdAt: notifInsert.rows[0].created_at.toISOString(),
        });

        sendToUser(user.id, 'message:new', messagePayload);

        res.status(201).json({ message: messagePayload, conversationStatus: nextStatus });
      } catch (dbErr: any) {
        await client.query('ROLLBACK');
        if (dbErr?.message?.includes('5 MB')) {
          res.status(400).json({ error: dbErr.message });
          return;
        }
        throw dbErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[Send Message] Error:', err);
      res.status(500).json({ error: 'Failed to send message.' });
    }
  });

  app.patch('/api/messages/:messageId', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { messageId } = req.params;
      if (!isValidUuid(messageId)) {
        res.status(400).json({ error: 'Invalid message ID.' });
        return;
      }

      const { body } = req.body ?? {};
      if (typeof body !== 'string' || !body.trim()) {
        res.status(400).json({ error: 'Message body cannot be empty.' });
        return;
      }

      const cleanBody = body.trim().slice(0, 4000);

      const msgRes = await pool.query<{
        id: string;
        conversation_id: string;
        sender_id: string;
        deleted_at: Date | null;
      }>(
        `SELECT id, conversation_id, sender_id, deleted_at
         FROM messages
         WHERE id = $1
         LIMIT 1`,
        [messageId]
      );

      if (msgRes.rowCount === 0) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }

      const msg = msgRes.rows[0];
      if (msg.sender_id !== user.id) {
        res.status(403).json({ error: 'You can only edit your own messages.' });
        return;
      }

      if (msg.deleted_at) {
        res.status(400).json({ error: 'Cannot edit a deleted message.' });
        return;
      }

      const updated = await pool.query<{ edited_at: Date }>(
        `UPDATE messages
         SET body = $1, edited_at = NOW()
         WHERE id = $2
         RETURNING edited_at`,
        [cleanBody, messageId]
      );

      const editedAtIso = updated.rows[0].edited_at.toISOString();

      const members = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM conversation_members WHERE conversation_id = $1`,
        [msg.conversation_id]
      );

      for (const m of members.rows) {
        sendToUser(m.user_id, 'message:updated', {
          id: messageId,
          conversationId: msg.conversation_id,
          body: cleanBody,
          isDeleted: false,
          editedAt: editedAtIso,
        });
      }

      res.json({
        message: {
          id: messageId,
          conversationId: msg.conversation_id,
          body: cleanBody,
          isDeleted: false,
          editedAt: editedAtIso,
        },
      });
    } catch (err) {
      console.error('[Edit Message] Error:', err);
      res.status(500).json({ error: 'Failed to edit message.' });
    }
  });

  app.delete('/api/messages/:messageId', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { messageId } = req.params;
      if (!isValidUuid(messageId)) {
        res.status(400).json({ error: 'Invalid message ID.' });
        return;
      }

      const msgRes = await pool.query<{
        id: string;
        conversation_id: string;
        sender_id: string;
      }>(
        `SELECT id, conversation_id, sender_id FROM messages WHERE id = $1 LIMIT 1`,
        [messageId]
      );

      if (msgRes.rowCount === 0) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }

      const msg = msgRes.rows[0];
      if (msg.sender_id !== user.id) {
        res.status(403).json({ error: 'You can only delete your own messages.' });
        return;
      }

      await pool.query(
        `UPDATE messages SET body = '', deleted_at = NOW() WHERE id = $1`,
        [messageId]
      );
      await pool.query(`DELETE FROM chat_attachments WHERE message_id = $1`, [messageId]);

      const members = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM conversation_members WHERE conversation_id = $1`,
        [msg.conversation_id]
      );

      for (const m of members.rows) {
        sendToUser(m.user_id, 'message:updated', {
          id: messageId,
          conversationId: msg.conversation_id,
          body: '',
          isDeleted: true,
          editedAt: null,
        });
      }

      res.json({ success: true, id: messageId });
    } catch (err) {
      console.error('[Delete Message] Error:', err);
      res.status(500).json({ error: 'Failed to delete message.' });
    }
  });

  app.post('/api/conversations/:id/read', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const conversationId = req.params.id;
      if (!isValidUuid(conversationId)) {
        res.status(400).json({ error: 'Invalid conversation ID.' });
        return;
      }

      const memberCheck = await pool.query<{ peer_id: string }>(
        `SELECT cm_peer.user_id AS peer_id
         FROM conversation_members cm_me
         JOIN conversation_members cm_peer ON cm_peer.conversation_id = cm_me.conversation_id AND cm_peer.user_id <> $1
         WHERE cm_me.conversation_id = $2 AND cm_me.user_id = $1
         LIMIT 1`,
        [user.id, conversationId]
      );

      if (memberCheck.rowCount === 0) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }

      await pool.query(
        `INSERT INTO message_reads (message_id, user_id, read_at)
         SELECT m.id, $1, NOW()
         FROM messages m
         LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = $1
         WHERE m.conversation_id = $2 AND m.sender_id <> $1 AND mr.message_id IS NULL
         ON CONFLICT DO NOTHING`,
        [user.id, conversationId]
      );

      await pool.query(
        `UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, user.id]
      );

      sendToUser(memberCheck.rows[0].peer_id, 'message:read', {
        conversationId,
        readByUsername: user.username,
        readAt: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[Mark Read] Error:', err);
      res.status(500).json({ error: 'Failed to mark messages as read.' });
    }
  });

  // ==========================================================================
  // BLOCKING ROUTES (Requirement 14)
  // ==========================================================================

  app.get('/api/blocks', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const result = await pool.query<{
        username: string;
        avatar_color: string;
        bio: string;
        created_at: Date;
      }>(
        `SELECT u.username, u.avatar_color, u.bio, b.created_at
         FROM user_blocks b
         JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = $1 AND u.deleted_at IS NULL
         ORDER BY b.created_at DESC`,
        [user.id]
      );

      res.json({
        blockedUsers: result.rows.map((r) => ({
          username: r.username,
          avatarColor: r.avatar_color,
          bio: r.bio,
          blockedAt: r.created_at.toISOString(),
        })),
      });
    } catch (err) {
      console.error('[Get Blocks] Error:', err);
      res.status(500).json({ error: 'Failed to load blocked users.' });
    }
  });

  app.post('/api/blocks', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { username } = req.body ?? {};
      const targetNormalized =
        typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';

      if (!targetNormalized) {
        res.status(400).json({ error: 'Username is required.' });
        return;
      }

      if (targetNormalized === user.usernameNormalized) {
        res.status(400).json({ error: 'You cannot block yourself.' });
        return;
      }

      const targetRes = await pool.query<{ id: string; username: string }>(
        `SELECT id, username FROM users WHERE username_normalized = $1 AND deleted_at IS NULL LIMIT 1`,
        [targetNormalized]
      );

      if (targetRes.rowCount === 0) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const target = targetRes.rows[0];
      await pool.query(
        `INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
        [user.id, target.id]
      );

      sendToUser(target.id, 'conversation:updated', { blockedUpdate: true });
      sendToUser(user.id, 'conversation:updated', { blockedUpdate: true });

      res.status(201).json({
        success: true,
        blockedUsername: target.username,
      });
    } catch (err) {
      console.error('[Block User] Error:', err);
      res.status(500).json({ error: 'Failed to block user.' });
    }
  });

  app.delete('/api/blocks/:username', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const targetNormalized = (req.params.username || '').trim().replace(/^@/, '').toLowerCase();

      const targetRes = await pool.query<{ id: string; username: string }>(
        `SELECT id, username FROM users WHERE username_normalized = $1 LIMIT 1`,
        [targetNormalized]
      );

      if (targetRes.rowCount === 0) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const target = targetRes.rows[0];
      await pool.query(
        `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
        [user.id, target.id]
      );

      sendToUser(target.id, 'conversation:updated', { blockedUpdate: true });
      sendToUser(user.id, 'conversation:updated', { blockedUpdate: true });

      res.json({ success: true, unblockedUsername: target.username });
    } catch (err) {
      console.error('[Unblock User] Error:', err);
      res.status(500).json({ error: 'Failed to unblock user.' });
    }
  });

  // ==========================================================================
  // REPORTING ROUTE (Requirement 15)
  // ==========================================================================

  app.post('/api/reports', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { username, messageId, reason } = req.body ?? {};

      const targetNormalized =
        typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';
      if (!targetNormalized) {
        res.status(400).json({ error: 'Reported username is required.' });
        return;
      }

      if (typeof reason !== 'string' || reason.trim().length < 5) {
        res.status(400).json({ error: 'Please provide a brief reason (at least 5 characters).' });
        return;
      }

      const cleanReason = reason.trim().slice(0, 1000);

      const targetRes = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE username_normalized = $1 LIMIT 1`,
        [targetNormalized]
      );

      if (targetRes.rowCount === 0) {
        res.status(404).json({ error: 'Reported user not found.' });
        return;
      }

      const targetId = targetRes.rows[0].id;
      if (targetId === user.id) {
        res.status(400).json({ error: 'You cannot report yourself.' });
        return;
      }

      let validMessageId: string | null = null;
      if (messageId && isValidUuid(messageId)) {
        const msgCheck = await pool.query<{ id: string }>(
          `SELECT m.id
           FROM messages m
           JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
           WHERE m.id = $2
           LIMIT 1`,
          [user.id, messageId]
        );
        if ((msgCheck.rowCount ?? 0) > 0) {
          validMessageId = messageId;
        }
      }

      await pool.query(
        `INSERT INTO reports (reporter_id, reported_user_id, message_id, reason, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW())`,
        [user.id, targetId, validMessageId, cleanReason]
      );

      res.status(201).json({
        success: true,
        message: 'Report submitted for review. Thank you for helping keep VaultChat safe.',
      });
    } catch (err) {
      console.error('[Report] Error:', err);
      res.status(500).json({ error: 'Failed to submit report.' });
    }
  });

  // ==========================================================================
  // NOTIFICATIONS ROUTES (Requirement 33)
  // ==========================================================================

  app.get('/api/notifications', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const result = await pool.query<{
        id: string;
        conversation_id: string | null;
        type: string;
        title: string;
        body: string;
        is_read: boolean;
        created_at: Date;
        actor_username: string | null;
      }>(
        `SELECT
           n.id,
           n.conversation_id,
           n.type,
           n.title,
           n.body,
           n.is_read,
           n.created_at,
           u.username AS actor_username
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
         WHERE n.recipient_id = $1
         ORDER BY n.created_at DESC
         LIMIT 50`,
        [user.id]
      );

      res.json({
        notifications: result.rows.map((n) => ({
          id: n.id,
          conversationId: n.conversation_id,
          type: n.type,
          title: n.title,
          body: n.body,
          actorUsername: n.actor_username,
          isRead: n.is_read,
          createdAt: n.created_at.toISOString(),
        })),
      });
    } catch (err) {
      console.error('[Get Notifications] Error:', err);
      res.status(500).json({ error: 'Failed to load notifications.' });
    }
  });

  app.post('/api/notifications/:id/read', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      if (!isValidUuid(id)) {
        res.status(400).json({ error: 'Invalid notification ID.' });
        return;
      }

      await pool.query(
        `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND recipient_id = $2`,
        [id, user.id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error('[Mark Notification Read] Error:', err);
      res.status(500).json({ error: 'Failed to update notification.' });
    }
  });

  app.post('/api/notifications/read-all', authenticateMiddleware, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      await pool.query(
        `UPDATE notifications SET is_read = TRUE WHERE recipient_id = $1 AND is_read = FALSE`,
        [user.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[Mark All Notifications Read] Error:', err);
      res.status(500).json({ error: 'Failed to update notifications.' });
    }
  });

  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[VaultChat] Server running! Open in your browser: http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
