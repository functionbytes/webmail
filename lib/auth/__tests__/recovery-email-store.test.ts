/**
 * Tests for recovery-email-store.ts
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
  tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bulwark-recovery-'));
});

afterEach(() => {
  fsSync.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('recovery-email-store', () => {
  it('getRecoveryEmail returns null when no entry exists', async () => {
    const { getRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    expect(getRecoveryEmail('alice')).toBeNull();
  });

  it('getRecoveryEmail returns null when file is missing (ENOENT)', async () => {
    // No file created in tmpDir, so readStore catches ENOENT → returns {}
    const { getRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    expect(getRecoveryEmail('nobody')).toBeNull();
  });

  it('setRecoveryEmail persists and getRecoveryEmail reads it back', async () => {
    const { setRecoveryEmail, getRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    await setRecoveryEmail('alice', 'alice-recovery@example.com');
    expect(getRecoveryEmail('alice')).toBe('alice-recovery@example.com');
  });

  it('setRecoveryEmail uses atomic write (tmp + rename)', async () => {
    const { setRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    await setRecoveryEmail('bob', 'bob@recovery.test');
    // .tmp file must have been cleaned up (rename removes it)
    const tmpFile = path.join(tmpDir, 'recovery-emails.json.tmp');
    expect(fsSync.existsSync(tmpFile)).toBe(false);
    // Final file must exist
    const destFile = path.join(tmpDir, 'recovery-emails.json');
    expect(fsSync.existsSync(destFile)).toBe(true);
  });

  it('deleteRecoveryEmail removes an existing entry', async () => {
    const { setRecoveryEmail, deleteRecoveryEmail, getRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    await setRecoveryEmail('carol', 'carol@recovery.test');
    await deleteRecoveryEmail('carol');
    expect(getRecoveryEmail('carol')).toBeNull();
  });

  it('deleteRecoveryEmail is a no-op for unknown user', async () => {
    const { setRecoveryEmail, deleteRecoveryEmail, getRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    await setRecoveryEmail('dave', 'd@r.test');
    await deleteRecoveryEmail('nobody');
    expect(getRecoveryEmail('dave')).toBe('d@r.test');
  });

  it('creates state dir if it does not exist', async () => {
    // Use a nested tmpDir that doesn't exist yet
    const nestedDir = path.join(tmpDir, 'nested', 'state');
    tmpDir = nestedDir; // override for this test
    const { setRecoveryEmail } = await import('@/lib/auth/recovery-email-store');
    await setRecoveryEmail('eve', 'e@r.test');
    expect(fsSync.existsSync(nestedDir)).toBe(true);
  });
});

