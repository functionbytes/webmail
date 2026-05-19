import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { getStatePath, getStateDir } from '@/lib/admin/paths';
import { logger } from '@/lib/logger';

const TOKEN_FILE = 'password-reset-tokens.json';
const TOKEN_TTL_MS = 60 * 60 * 1000;       // 1 hour
const MAX_ACTIVE_TOKENS = 3;               // per user
const MIN_REQUEST_INTERVAL_MS = 60 * 1000; // 1 min between requests per user

interface StoredToken {
  hash: string;
  username: string;
  serverUrl: string;
  createdAt: number;
  usedAt?: number;
}

// ─── In-process write mutex ───────────────────────────────────────────────────
// Prevents concurrent requests from overwriting each other's changes.
let writeLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => T): Promise<T> {
  const next = writeLock.then(fn);
  // Swallow the rejection on the chain so it doesn't become an unhandled rejection,
  // but the caller still gets the real error.
  writeLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// ─── File I/O helpers ─────────────────────────────────────────────────────────

function readStore(): StoredToken[] {
  try {
    return JSON.parse(readFileSync(getStatePath(TOKEN_FILE), 'utf-8')) as StoredToken[];
  } catch {
    return [];
  }
}

/** Atomic write: write to a tmp file then rename into place. */
function writeStore(tokens: StoredToken[]): void {
  try {
    mkdirSync(getStateDir(), { recursive: true });
    const dest = getStatePath(TOKEN_FILE);
    const tmp = dest + '.tmp';
    writeFileSync(tmp, JSON.stringify(tokens), 'utf-8');
    renameSync(tmp, dest);
  } catch (err) {
    logger.error('Failed to write password-reset token store', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type CreateResetTokenResult =
  | { token: string }
  | { rateLimited: true };

export function createResetToken(
  username: string,
  serverUrl: string,
): Promise<CreateResetTokenResult> {
  return withLock<CreateResetTokenResult>(() => {
    const now = Date.now();
    // Purge expired tokens first
    let tokens = readStore().filter((t) => now - t.createdAt < TOKEN_TTL_MS);

    const active = tokens.filter((t) => t.username === username && !t.usedAt);

    // Enforce minimum interval between requests
    if (active.some((t) => now - t.createdAt < MIN_REQUEST_INTERVAL_MS)) {
      return { rateLimited: true };
    }

    // Cap total active tokens per user
    if (active.length >= MAX_ACTIVE_TOKENS) {
      return { rateLimited: true };
    }

    const raw = randomBytes(32).toString('hex');
    tokens.push({ hash: hashToken(raw), username, serverUrl, createdAt: now });
    writeStore(tokens);
    return { token: raw };
  });
}

export function consumeResetToken(
  rawToken: string,
): { username: string; serverUrl: string } | null {
  // Peek-only: find the matching token and return its metadata WITHOUT marking
  // it as used. The caller (reset-password route) must call markTokenUsed()
  // after the password has been successfully updated.
  const now = Date.now();
  const tokens = readStore().filter((t) => now - t.createdAt < TOKEN_TTL_MS);

  const inputHash = hashToken(rawToken);
  const inputBuf = Buffer.from(inputHash, 'hex');

  const match = tokens.find((t) => {
    if (t.usedAt) return false;
    try {
      return timingSafeEqual(Buffer.from(t.hash, 'hex'), inputBuf);
    } catch {
      return false;
    }
  });

  if (!match) return null;
  return { username: match.username, serverUrl: match.serverUrl };
}

/** Mark a token as used. Call ONLY after the password update succeeds. */
export function markTokenUsed(rawToken: string): Promise<void> {
  return withLock(() => {
    const now = Date.now();
    let tokens = readStore().filter((t) => now - t.createdAt < TOKEN_TTL_MS);

    const inputHash = hashToken(rawToken);
    const inputBuf = Buffer.from(inputHash, 'hex');

    const idx = tokens.findIndex((t) => {
      if (t.usedAt) return false;
      try {
        return timingSafeEqual(Buffer.from(t.hash, 'hex'), inputBuf);
      } catch {
        return false;
      }
    });

    if (idx !== -1) {
      tokens[idx] = { ...tokens[idx], usedAt: now };
      writeStore(tokens);
    }
  });
}
