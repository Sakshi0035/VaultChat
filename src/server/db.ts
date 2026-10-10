import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const { Pool } = pg;

function normalizeNeonUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  // Upgrade sslmode=require to sslmode=verify-full to silence pg v8/v9 deprecation warning
  return rawUrl.replace(/sslmode=require\b/g, 'sslmode=verify-full');
}

let currentConnectionString = normalizeNeonUrl(process.env.DATABASE_URL || '');
let activePool: pg.Pool | null = null;
let migrationsApplied = false;

// Auto-generated server-side secrets persisted in Neon (or memory until DB connects)
let runtimeSessionSecret =
  process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
let runtimeCleanupSecret =
  process.env.CLEANUP_CRON_SECRET || crypto.randomBytes(32).toString('hex');

export function getSessionSecret(): string {
  return process.env.SESSION_SECRET || runtimeSessionSecret;
}

export function getCleanupSecret(): string {
  return process.env.CLEANUP_CRON_SECRET || runtimeCleanupSecret;
}

export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL || currentConnectionString;
  return Boolean(url && url.trim().startsWith('postgres'));
}

export function getPool(): pg.Pool {
  const envUrl = normalizeNeonUrl(process.env.DATABASE_URL || '');
  if (!activePool || (envUrl && envUrl !== currentConnectionString)) {
    if (envUrl) {
      currentConnectionString = envUrl;
    }
    if (!currentConnectionString) {
      throw new Error(
        'DATABASE_URL is not configured yet. Please add your Neon PostgreSQL connection string in the DATABASE_URL environment variable.'
      );
    }
    activePool = new Pool({
      connectionString: currentConnectionString,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    activePool.on('error', (err) => {
      console.error('Unexpected Neon PostgreSQL pool error:', err.message);
    });
  }
  return activePool;
}

// Proxy object so existing `pool.query(...)` calls work seamlessly and lazily initialize
export const pool = {
  query: async <T extends pg.QueryResultRow = any>(
    text: string,
    values?: any[]
  ): Promise<pg.QueryResult<T>> => {
    await ensureMigrationsAndSecrets();
    return getPool().query<T>(text, values);
  },
  connect: async (): Promise<pg.PoolClient> => {
    await ensureMigrationsAndSecrets();
    return getPool().connect();
  },
  end: async (): Promise<void> => {
    if (activePool) {
      await activePool.end();
      activePool = null;
    }
  },
};

export async function ensureMigrationsAndSecrets(): Promise<boolean> {
  if (migrationsApplied) return true;
  if (!isDatabaseConfigured()) return false;

  const migrationPath = path.resolve(process.cwd(), 'migrations', '001_initial_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  const rawPool = getPool();
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);

    // Ensure auto-generated SESSION_SECRET and CLEANUP_CRON_SECRET are persisted in Neon
    const sessionSecretRes = await client.query<{ secret_value: string }>(
      `INSERT INTO server_secrets (key_name, secret_value)
       VALUES ('SESSION_SECRET', $1)
       ON CONFLICT (key_name) DO UPDATE SET key_name = EXCLUDED.key_name
       RETURNING secret_value`,
      [runtimeSessionSecret]
    );
    if (sessionSecretRes.rows[0]?.secret_value && !process.env.SESSION_SECRET) {
      runtimeSessionSecret = sessionSecretRes.rows[0].secret_value;
    }

    const cleanupSecretRes = await client.query<{ secret_value: string }>(
      `INSERT INTO server_secrets (key_name, secret_value)
       VALUES ('CLEANUP_CRON_SECRET', $1)
       ON CONFLICT (key_name) DO UPDATE SET key_name = EXCLUDED.key_name
       RETURNING secret_value`,
      [runtimeCleanupSecret]
    );
    if (cleanupSecretRes.rows[0]?.secret_value && !process.env.CLEANUP_CRON_SECRET) {
      runtimeCleanupSecret = cleanupSecretRes.rows[0].secret_value;
    }

    await client.query('COMMIT');
    migrationsApplied = true;
    console.log('[Neon DB] Schema migration and server secrets verified in Neon PostgreSQL.');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Neon DB] Migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  if (!isDatabaseConfigured()) {
    console.warn(
      '[Neon DB] DATABASE_URL is not set yet. Waiting for DATABASE_URL environment variable to run migrations.'
    );
    return;
  }
  await ensureMigrationsAndSecrets();
}

/**
 * Automatic 9-Month Inactivity Account Deletion
 *
 * Deletes accounts where `last_login_at < NOW() - INTERVAL '9 months'`.
 * Notice this uses `last_login_at` (authenticated sign-in timestamp),
 * NOT `last_active_at` (browser tab / WebSocket activity).
 *
 * Foreign keys (`ON DELETE CASCADE`) and the `trg_cleanup_orphaned_conversation`
 * trigger automatically remove all dependent:
 * - user_sessions
 * - messages, chat_attachments (bucket 'chats'), & message_reads
 * - conversation_members & 1-to-1 conversations
 * - notifications
 * - user_blocks
 * - reports
 */
export async function runInactiveAccountCleanup(): Promise<{
  deletedUsersCount: number;
  deletedUsernames: string[];
  purgedExpiredSessionsCount: number;
  executedAt: string;
}> {
  if (!isDatabaseConfigured()) {
    return {
      deletedUsersCount: 0,
      deletedUsernames: [],
      purgedExpiredSessionsCount: 0,
      executedAt: new Date().toISOString(),
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Delete expired or revoked sessions
    const expiredSessionsResult = await client.query(
      `DELETE FROM user_sessions
       WHERE expires_at < NOW() OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day')`
    );

    // 2. Delete all 1-to-1 conversations involving users whose last_login_at is older than 9 months
    await client.query(
      `DELETE FROM conversations
       WHERE id IN (
         SELECT cm.conversation_id
         FROM conversation_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE u.last_login_at < NOW() - INTERVAL '9 months'
       )`
    );

    // 3. Delete users who have NOT signed in for 9 months (cascades to sessions, messages, chat_attachments, blocks, reports, notifications)
    const deletedUsersResult = await client.query<{ id: string; username: string }>(
      `DELETE FROM users
       WHERE last_login_at < NOW() - INTERVAL '9 months'
       RETURNING id, username`
    );

    await client.query('COMMIT');

    return {
      deletedUsersCount: deletedUsersResult.rowCount ?? 0,
      deletedUsernames: deletedUsersResult.rows.map((r) => r.username),
      purgedExpiredSessionsCount: expiredSessionsResult.rowCount ?? 0,
      executedAt: new Date().toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Neon DB] Inactive account cleanup error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a specific user account and all associated data in a single transaction.
 */
export async function deleteUserAccountCompletely(userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete all 1-to-1 conversations where this user is a member
    await client.query(
      `DELETE FROM conversations
       WHERE id IN (
         SELECT conversation_id FROM conversation_members WHERE user_id = $1
       )`,
      [userId]
    );

    // Delete the user record (cascades to user_sessions, messages, chat_attachments, message_reads, user_blocks, reports, notifications)
    const res = await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query('COMMIT');
    return (res.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
