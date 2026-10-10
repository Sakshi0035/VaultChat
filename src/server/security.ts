import crypto from 'crypto';
import { getSessionSecret } from './db.ts';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

function scryptDerive(
  password: string,
  salt: string,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Hashes a plaintext password using Node's native cryptographic scrypt KDF
 * with a unique 32-byte cryptographically random salt.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(32).toString('hex');
  const derivedKey = await scryptDerive(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });

  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash using constant-time comparison.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }
    const cost = parseInt(parts[1], 10);
    const blockSize = parseInt(parts[2], 10);
    const parallelization = parseInt(parts[3], 10);
    const salt = parts[4];
    const originalHashHex = parts[5];

    const originalBuffer = Buffer.from(originalHashHex, 'hex');
    const derivedKey = await scryptDerive(password, salt, originalBuffer.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
    });

    if (originalBuffer.length !== derivedKey.length) {
      return false;
    }
    return crypto.timingSafeEqual(originalBuffer, derivedKey);
  } catch {
    return false;
  }
}

// Precomputed dummy hash to prevent timing attacks when a username does not exist during login
let DUMMY_PASSWORD_HASH: string | null = null;
export async function verifyDummyPassword(password: string): Promise<void> {
  if (!DUMMY_PASSWORD_HASH) {
    DUMMY_PASSWORD_HASH = await hashPassword('dummy_constant_time_protection_password_12345!');
  }
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
}

/**
 * Generates a cryptographically random token and its SHA-256 hash for database storage.
 */
export function generateSessionTokens(): {
  rawToken: string;
  tokenHash: string;
  csrfToken: string;
} {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  return { rawToken, tokenHash, csrfToken };
}

export function hashSessionToken(rawToken: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
}

/**
 * Validates username requirements:
 * - Minimum 3 characters
 * - Maximum 30 characters
 * - Letters, numbers, and underscore only
 */
export function validateUsername(username: unknown): {
  valid: boolean;
  normalized: string;
  trimmed: string;
  error?: string;
} {
  if (typeof username !== 'string') {
    return { valid: false, normalized: '', trimmed: '', error: 'Username is required.' };
  }
  const trimmed = username.trim();
  if (trimmed.length < 3) {
    return { valid: false, normalized: '', trimmed, error: 'Username must be at least 3 characters long.' };
  }
  if (trimmed.length > 30) {
    return { valid: false, normalized: '', trimmed, error: 'Username cannot exceed 30 characters.' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return {
      valid: false,
      normalized: '',
      trimmed,
      error: 'Username may only contain letters, numbers, and underscores.',
    };
  }
  return {
    valid: true,
    trimmed,
    normalized: trimmed.toLowerCase(),
  };
}

/**
 * Validates password requirements:
 * - Minimum 8 characters
 * - Maximum 128 characters
 */
export function validatePassword(password: unknown): {
  valid: boolean;
  error?: string;
} {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password cannot exceed 128 characters.' };
  }
  return { valid: true };
}

/**
 * Deterministic Rich Crimson / Dark Pinked Red avatar color palette
 */
export const AVATAR_COLORS = [
  '#E11D48', // Rich Rose-Red
  '#BE123C', // Deep Crimson
  '#DB2777', // Rich Pink
  '#9F1239', // Ruby Red
  '#EC4899', // Vibrant Rose Pink
  '#881337', // Dark Burgundy Rose
  '#F43F5E', // Coral Crimson
  '#A21CAF', // Deep Magenta Berry
];

export function pickAvatarColor(usernameNormalized: string): string {
  let hash = 0;
  for (let i = 0; i < usernameNormalized.length; i++) {
    hash = (hash * 31 + usernameNormalized.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Rate Limiter & Brute-Force Protection with Progressive Delay
 */
interface RateBucket {
  count: number;
  resetAt: number;
  failedAttempts: number;
  blockedUntil: number;
}

const loginBuckets = new Map<string, RateBucket>();
const signupBuckets = new Map<string, RateBucket>();
const messageBuckets = new Map<string, RateBucket>();

// Clean up stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of loginBuckets.entries()) {
    if (b.resetAt < now && b.blockedUntil < now) loginBuckets.delete(key);
  }
  for (const [key, b] of signupBuckets.entries()) {
    if (b.resetAt < now) signupBuckets.delete(key);
  }
  for (const [key, b] of messageBuckets.entries()) {
    if (b.resetAt < now) messageBuckets.delete(key);
  }
}, 60_000).unref();

export async function checkLoginRateLimit(key: string): Promise<{
  allowed: boolean;
  retryAfterSeconds?: number;
}> {
  const now = Date.now();
  let bucket = loginBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = {
      count: 0,
      resetAt: now + 15 * 60 * 1000, // 15-minute window
      failedAttempts: 0,
      blockedUntil: 0,
    };
    loginBuckets.set(key, bucket);
  }

  if (bucket.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((bucket.blockedUntil - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  bucket.count += 1;
  if (bucket.count > 12) {
    bucket.blockedUntil = now + 60 * 1000; // 60s temporary cooldown (never permanent lockout)
    return { allowed: false, retryAfterSeconds: 60 };
  }

  // Progressive delay on repeated failed attempts (up to 1500ms)
  if (bucket.failedAttempts >= 3) {
    const delayMs = Math.min(1500, (bucket.failedAttempts - 2) * 300);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { allowed: true };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (bucket) {
    bucket.failedAttempts += 1;
    if (bucket.failedAttempts >= 8) {
      bucket.blockedUntil = now + 60 * 1000;
    }
  }
}

export function clearLoginFailures(key: string): void {
  loginBuckets.delete(key);
}

export function checkWindowRateLimit(
  store: 'signup' | 'message',
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds?: number } {
  const map = store === 'signup' ? signupBuckets : messageBuckets;
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs, failedAttempts: 0, blockedUntil: 0 };
    map.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true };
}
