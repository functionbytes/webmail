/**
 * Tests for password-reset-store.ts
 * Uses a real temp directory to avoid complex fs mock issues.
 */
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir = '';

vi.mock('@/lib/admin/paths', () => ({
  getStatePath: (f: string) => path.join(tmpDir, f),
  getStateDir: () => tmpDir,
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bulwark-pwreset-'));
});

afterEach(() => {
  fsSync.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createResetToken', () => {
  it('returns a token string on first call', async () => {
    const { createResetToken } = await import('@/lib/auth/password-reset-store');
    const result = await createResetToken('alice', 'https://jmap.example.com');
    expect(result).toHaveProperty('token');
    expect(typeof (result as { token: string }).token).toBe('string');
    expect((result as { token: string }).token).toHaveLength(64); // 32 bytes hex
  });

  it('rate-limits when a token was created less than 1 minute ago', async () => {
    // Pre-write a token that was created 10 seconds ago
    const { createHash } = await import('node:crypto');
    const existingRaw = 'aa'.repeat(32);
    const hash = createHash('sha256').update(existingRaw).digest('hex');
    const existing = [{ hash, username: 'alice', serverUrl: 's', createdAt: Date.now() - 10_000 }];
    fsSync.writeFileSync(path.join(tmpDir, 'password-reset-tokens.json'), JSON.stringify(existing), 'utf-8');

    const { createResetToken } = await import('@/lib/auth/password-reset-store');
    const result = await createResetToken('alice', 's');
    expect(result).toHaveProperty('rateLimited', true);
  });

  it('rate-limits when user already has MAX_ACTIVE_TOKENS (3)', async () => {
    const { createHash } = await import('node:crypto');
    const now = Date.now();
    const old = now - 120_000; // 2 min ago — past 1-min interval, within TTL
    const tokens = ['a1', 'a2', 'a3'].map((seed, i) => ({
      hash: createHash('sha256').update(seed.repeat(32)).digest('hex'),
      username: 'alice', serverUrl: 's', createdAt: old + i * 10,
    }));
    fsSync.writeFileSync(path.join(tmpDir, 'password-reset-tokens.json'), JSON.stringify(tokens), 'utf-8');

    const { createResetToken } = await import('@/lib/auth/password-reset-store');
    const result = await createResetToken('alice', 's');
    expect(result).toHaveProperty('rateLimited', true);
  });

  it('purges expired tokens before evaluating limits', async () => {
    const { createHash } = await import('node:crypto');
    const now = Date.now();
    // 3 expired tokens (> 1h old)
    const tokens = ['e1', 'e2', 'e3'].map((seed, i) => ({
      hash: createHash('sha256').update(seed.repeat(32)).digest('hex'),
      username: 'alice', serverUrl: 's', createdAt: now - 4_000_000 + i,
    }));
    fsSync.writeFileSync(path.join(tmpDir, 'password-reset-tokens.json'), JSON.stringify(tokens), 'utf-8');

    const { createResetToken } = await import('@/lib/auth/password-reset-store');
    const result = await createResetToken('alice', 's');
    expect(result).toHaveProperty('token'); // succeeds after purge
  });

  it('writes to a .tmp file then renames atomically', async () => {
    const { createResetToken } = await import('@/lib/auth/password-reset-store');
    await createResetToken('bob', 's');
    // Final file exists, .tmp was cleaned up
    expect(fsSync.existsSync(path.join(tmpDir, 'password-reset-tokens.json'))).toBe(true);
    expect(fsSync.existsSync(path.join(tmpDir, 'password-reset-tokens.json.tmp'))).toBe(false);
  });
});

describe('consumeResetToken + markTokenUsed', () => {
  it('consumeResetToken returns null for unknown token', async () => {
    const { consumeResetToken } = await import('@/lib/auth/password-reset-store');
    expect(consumeResetToken('deadbeef'.repeat(8))).toBeNull();
  });

  it('round-trip: create → consume → markTokenUsed → consume returns null', async () => {
    const { createResetToken, consumeResetToken, markTokenUsed } = await import('@/lib/auth/password-reset-store');

    const created = await createResetToken('carol', 'https://jmap.example.com') as { token: string };
    const raw = created.token;

    // consume (peek) should work
    const peek = consumeResetToken(raw);
    expect(peek).toEqual({ username: 'carol', serverUrl: 'https://jmap.example.com' });

    // peek again before marking — still valid
    expect(consumeResetToken(raw)).not.toBeNull();

    // mark used (simulates successful password update)
    await markTokenUsed(raw);

    // now consume should return null
    expect(consumeResetToken(raw)).toBeNull();
  });

  it('consumeResetToken returns null for already-used token', async () => {
    const { createHash } = await import('node:crypto');
    const raw = 'cafebabe'.repeat(8);
    const hash = createHash('sha256').update(raw).digest('hex');
    const now = Date.now();
    fsSync.writeFileSync(
      path.join(tmpDir, 'password-reset-tokens.json'),
      JSON.stringify([{ hash, username: 'dave', serverUrl: 's', createdAt: now - 1000, usedAt: now - 500 }]),
      'utf-8',
    );
    const { consumeResetToken } = await import('@/lib/auth/password-reset-store');
    expect(consumeResetToken(raw)).toBeNull();
  });

  it('consumeResetToken returns null for expired token', async () => {
    const { createHash } = await import('node:crypto');
    const raw = 'deaddead'.repeat(8);
    const hash = createHash('sha256').update(raw).digest('hex');
    const expiredAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    fsSync.writeFileSync(
      path.join(tmpDir, 'password-reset-tokens.json'),
      JSON.stringify([{ hash, username: 'eve', serverUrl: 's', createdAt: expiredAt }]),
      'utf-8',
    );
    const { consumeResetToken } = await import('@/lib/auth/password-reset-store');
    expect(consumeResetToken(raw)).toBeNull();
  });
});
