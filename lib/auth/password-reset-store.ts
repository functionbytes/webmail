import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getStatePath, ensureStateDir } from '@/lib/admin/paths';
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

function readStore(): StoredToken[] {
  try {
    return JSON.parse(readFileSync(getStatePath(TOKEN_FILE), 'utf-8')) as StoredToken[];
  } catch {
    return [];
  }
}

function writeStore(tokens: StoredToken[]): void {
  try {
    ensureStateDir();
    writeFileSync(getStatePath(TOKEN_FILE), JSON.stringify(tokens), 'utf-8');
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

export type CreateResetTokenResult =
  | { token: string }
  | { rateLimited: true }
  | null;

export function createResetToken(
  username: string,
  serverUrl: string,
): CreateResetTokenResult {
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
}

export function consumeResetToken(
  rawToken: string,
): { username: string; serverUrl: string } | null {
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

  if (idx === -1) return null;

  const match = tokens[idx];
  tokens[idx] = { ...match, usedAt: now };
  writeStore(tokens);
  return { username: match.username, serverUrl: match.serverUrl };
}
