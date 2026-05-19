import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { getStatePath, getStateDir } from '@/lib/admin/paths';
import { logger } from '@/lib/logger';

const STORE_FILE = 'recovery-emails.json';

type RecoveryEmailMap = Record<string, string>; // username → recovery email

// ─── In-process write mutex ───────────────────────────────────────────────────
let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => T): Promise<T> {
  const next = writeLock.then(fn);
  writeLock = next.then(() => undefined, () => undefined);
  return next;
}

function readStore(): RecoveryEmailMap {
  try {
    return JSON.parse(readFileSync(getStatePath(STORE_FILE), 'utf-8')) as RecoveryEmailMap;
  } catch {
    return {};
  }
}

function writeStore(data: RecoveryEmailMap): void {
  mkdirSync(getStateDir(), { recursive: true });
  const dest = getStatePath(STORE_FILE);
  const tmp = dest + '.tmp';
  writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  renameSync(tmp, dest);
}

export function getRecoveryEmail(username: string): string | null {
  const store = readStore();
  return store[username] ?? null;
}

export function setRecoveryEmail(username: string, email: string): Promise<void> {
  return withLock(() => {
    const store = readStore();
    store[username] = email;
    writeStore(store);
    logger.info('Recovery email updated', { username });
  });
}

export function deleteRecoveryEmail(username: string): Promise<void> {
  return withLock(() => {
    const store = readStore();
    delete store[username];
    writeStore(store);
    logger.info('Recovery email deleted', { username });
  });
}
