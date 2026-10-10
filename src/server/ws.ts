import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { pool } from './db.ts';
import { hashSessionToken } from './security.ts';

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  username?: string;
  sessionId?: string;
  isAlive?: boolean;
}

// Map userId -> Set of connected WebSockets
const userSockets = new Map<string, Set<AuthenticatedSocket>>();

function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = decodeURIComponent(pair.slice(idx + 1).trim());
      result[key] = val;
    }
  }
  return result;
}

export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

export function isUsernameOnline(usernameNormalized: string, onlineUsernameSet?: Set<string>): boolean {
  if (onlineUsernameSet) return onlineUsernameSet.has(usernameNormalized);
  for (const sockets of userSockets.values()) {
    for (const ws of sockets) {
      if (ws.username && ws.username.toLowerCase() === usernameNormalized) {
        return true;
      }
    }
  }
  return false;
}

export function sendToUser(userId: string, event: string, payload: unknown): void {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

export function disconnectUserSessions(userId: string, exceptSessionId?: string): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (exceptSessionId && ws.sessionId === exceptSessionId) continue;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          event: 'session:revoked',
          payload: { reason: 'Your session has been signed out.' },
        })
      );
      ws.close(4001, 'Session revoked');
    }
  }
}

async function broadcastPresenceToContacts(userId: string, username: string, online: boolean): Promise<void> {
  try {
    // Notify all users who share a conversation with this user
    const res = await pool.query<{ peer_id: string }>(
      `SELECT DISTINCT cm2.user_id AS peer_id
       FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
       WHERE cm1.user_id = $1 AND cm2.user_id <> $1`,
      [userId]
    );
    for (const row of res.rows) {
      sendToUser(row.peer_id, 'presence:update', {
        username,
        isOnline: online,
        lastActiveAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[WS] Failed to broadcast presence:', err);
  }
}

export function setupWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws: AuthenticatedSocket, req: IncomingMessage) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      let rawToken: string | undefined = cookies['vaultchat_session'];

      // Fallback to query parameter token if third-party iframe cookies are restricted by browser settings
      if (!rawToken && req.url) {
        const urlObj = new URL(req.url, 'http://localhost:3000');
        rawToken = urlObj.searchParams.get('token') || undefined;
      }

      if (!rawToken) {
        ws.close(4001, 'Authentication required');
        return;
      }

      const tokenHash = hashSessionToken(rawToken);
      const sessionRes = await pool.query<{
        session_id: string;
        user_id: string;
        username: string;
      }>(
        `SELECT s.id AS session_id, u.id AS user_id, u.username
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > NOW()
           AND u.deleted_at IS NULL`,
        [tokenHash]
      );

      if (sessionRes.rowCount === 0) {
        ws.close(4001, 'Invalid or expired session');
        return;
      }

      const { session_id, user_id, username } = sessionRes.rows[0];
      ws.userId = user_id;
      ws.username = username;
      ws.sessionId = session_id;
      ws.isAlive = true;

      const wasOnline = isUserOnline(user_id);
      if (!userSockets.has(user_id)) {
        userSockets.set(user_id, new Set());
      }
      userSockets.get(user_id)!.add(ws);

      // Update last_active_at (NOTE: NEVER update last_login_at here per Requirement 30!)
      await pool.query(`UPDATE users SET last_active_at = NOW() WHERE id = $1`, [user_id]);

      if (!wasOnline) {
        void broadcastPresenceToContacts(user_id, username, true);
      }

      ws.send(
        JSON.stringify({
          event: 'connected',
          payload: { username, connectedAt: new Date().toISOString() },
        })
      );

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (rawData) => {
        try {
          const data = JSON.parse(rawData.toString());
          if (!ws.userId || !ws.username) return;

          if (data.event === 'typing:start' || data.event === 'typing:stop') {
            const conversationId = data.payload?.conversationId;
            if (typeof conversationId !== 'string') return;

            // Verify membership and block status before forwarding typing event
            const membersRes = await pool.query<{ user_id: string }>(
              `SELECT cm.user_id
               FROM conversation_members cm
               JOIN conversations c ON c.id = cm.conversation_id
               WHERE cm.conversation_id = $1 AND c.status = 'active'`,
              [conversationId]
            );

            const memberIds = membersRes.rows.map((r) => r.user_id);
            if (!memberIds.includes(ws.userId)) return;

            const peerIds = memberIds.filter((id) => id !== ws.userId);
            for (const peerId of peerIds) {
              // Ensure neither user has blocked the other
              const blockCheck = await pool.query(
                `SELECT 1 FROM user_blocks
                 WHERE (blocker_id = $1 AND blocked_id = $2)
                    OR (blocker_id = $2 AND blocked_id = $1)
                 LIMIT 1`,
                [ws.userId, peerId]
              );
              if (blockCheck.rowCount === 0) {
                sendToUser(peerId, 'typing:update', {
                  conversationId,
                  username: ws.username,
                  isTyping: data.event === 'typing:start',
                });
              }
            }
          } else if (data.event === 'ping') {
            // Update last_active_at only (never last_login_at)
            await pool.query(`UPDATE users SET last_active_at = NOW() WHERE id = $1`, [ws.userId]);
            ws.send(JSON.stringify({ event: 'pong', payload: { ts: Date.now() } }));
          }
        } catch {
          // Ignore malformed WS frames
        }
      });

      ws.on('close', async () => {
        if (!ws.userId || !ws.username) return;
        const set = userSockets.get(ws.userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            userSockets.delete(ws.userId);
            await pool
              .query(`UPDATE users SET last_active_at = NOW() WHERE id = $1`, [ws.userId])
              .catch(() => {});
            void broadcastPresenceToContacts(ws.userId, ws.username, false);
          }
        }
      });
    } catch (err) {
      console.error('[WS] Connection error:', err);
      ws.close(1011, 'Server error');
    }
  });

  // Heartbeat interval to clean up dead sockets
  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const ws = client as AuthenticatedSocket;
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}
