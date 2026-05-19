import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getStatePath, ensureStateDir } from '@/lib/admin/paths';

const TOKEN_FILE = 'password-reset-tokens.json';
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_TOKENS_PER_USER = 3;
const MIN_REQUEST_INTERVAL_MS = 60 * 1000; // min 1 minute between requests per user

interface StoredToken {
  hash: string;
  username: string;
  serverUrl: string;
  createdAt: number;
  usedAt?: number;
}

function readStore(): StoredToken[] {
  try {
    const data = readFileSync(getStatePath(TOKEN_FILE), 'utf-8');
    return JSON.parse(data) as StoredToken[];
  } catch {
    return [];
  }
}

async function writeStore(tokens: StoredToken[]): Promise<void> {
  await ensureStateDir();
  writeFileSync(getStatePath(TOKEN_FILE), JSON.stringify(tokens, null, 2), 'utf-8');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export type CreateResetTokenResult = { token: string } | { rateLimited: true } | null;

/**
 * Generate a new single-use, time-limited reset token for the given username.
 * Returns `{ rateLimited: true }` when the per-user rate limit is hit,
 * or `null` on unexpected errors.
 */
export async function createResetToken(
  username: string,
  serverUrl: string,
): Promise<CreateResetTokenResult> {
  const now = Date.now();
  let tokens = readStore();

  // Purge expired and already-used tokens
  tokens = tokens.filter((t) => !t.usedAt && now - t.createdAt < TOKEN_TTL_MS);

  const userTokens = tokens.filter((t) => t.username === username);

  // Rate-limit: at least 1 minute must pass since the last request per user
  const tooRecent = userTokens.some((t) => now - t.createdAt < MIN_REQUEST_INTERVAL_MS);
  if (tooRecent) return { rateLimited: true };

  // Hard cap on simultaneous active tokens per user
  if (userTokens.length >= MAX_TOKENS_PER_USER) return { rateLimited: true };

  const raw = randomBytes(32).toString('hex');
  tokens.push({ hash: hashToken(raw), username, serverUrl, createdAt: now });
  await writeStore(tokens);
  return { token: raw };
}

/**
 * Validate and consume a raw token (single-use).
 * Uses constant-time comparison to prevent timing attacks.
 * Returns `null` if the token is invalid, expired, or already used.
 */
export async function consumeResetToken(
  rawToken: string,
): Promise<{ username: string; serverUrl: string } | null> {
  const now = Date.now();
  let tokens = readStore();

  // Purge expired tokens
  tokens = tokens.filter((t) => now - t.createdAt < TOKEN_TTL_MS);

  const targetHash = hashToken(rawToken);
  const targetBuf = Buffer.from(targetHash, 'hex');

  const idx = tokens.findIndex((t) => {
    if (t.usedAt) return false;
    try {
      const storedBuf = Buffer.from(t.hash, 'hex');
      if (storedBuf.length !== targetBuf.length) return false;
      return timingSafeEqual(storedBuf, targetBuf);
    } catch {
      return false;
    }
  });

  if (idx === -1) return null;

  const match = tokens[idx];
  tokens[idx] = { ...match, usedAt: now };
  await writeStore(tokens);
  return { username: match.username, serverUrl: match.serverUrl };
}
