/**
 * Tests for app/api/auth/forgot-password/route.ts
 *
 * Key behaviours under test:
 *  - Returns {noRecoveryEmail:true} when user has no recovery email (not ok())
 *  - Returns {noRecoveryEmail:true} for unknown users (anti-enumeration)
 *  - Sends reset email when recovery email IS present
 *  - Respects IP rate limit (still returns ok() to avoid leaking)
 *  - Returns 404 when forgotPasswordEnabled=false
 *  - Accepts both "email" and "username" fields in the request body
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── NextResponse mock ─────────────────────────────────────────────────────────
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}));

// ── configManager mock ────────────────────────────────────────────────────────
const configValues: Record<string, unknown> = {};
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(),
    get: vi.fn((key: string, def: unknown) => configValues[key] ?? def),
  },
}));

// ── Rate limiter mock ─────────────────────────────────────────────────────────
const mockCheckRateLimit = vi.fn(() => ({ allowed: true, remaining: 5, retryAfterMs: 0 }));
vi.mock('@/lib/auth/reset-rate-limit', () => ({ checkResetRateLimit: (...a: unknown[]) => (mockCheckRateLimit as any)(...a) }));

// ── Token store mock ──────────────────────────────────────────────────────────
const mockCreateResetToken = vi.fn(async () => ({ token: 'test-token-abc' }));
vi.mock('@/lib/auth/password-reset-store', () => ({
  createResetToken: (...a: unknown[]) => (mockCreateResetToken as any)(...a),
}));

// ── Mailer mock ───────────────────────────────────────────────────────────────
const mockSendPasswordResetEmail = vi.fn(async () => undefined);
vi.mock('@/lib/auth/password-reset-mailer', () => ({
  sendPasswordResetEmail: (...a: unknown[]) => (mockSendPasswordResetEmail as any)(...a),
}));

// ── Stalwart admin mock ───────────────────────────────────────────────────────
const mockGetStalwartPrincipal = vi.fn(async () => ({
  name: 'alice',
  type: 'individual',
  emails: ['alice@example.com'],
  recoveryEmail: undefined as string | undefined,
}));
vi.mock('@/lib/auth/stalwart-admin', () => ({
  getStalwartPrincipal: (...a: unknown[]) => (mockGetStalwartPrincipal as any)(...a),
}));

// ── Recovery email store mock ─────────────────────────────────────────────────
const mockGetRecoveryEmail = vi.fn((_username: string): string | null => null);
vi.mock('@/lib/auth/recovery-email-store', () => ({
  getRecoveryEmail: (u: string) => mockGetRecoveryEmail(u),
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>, ip = '1.2.3.4') {
  return {
    headers: { get: (h: string) => (h === 'x-forwarded-for' ? ip : null) },
    json: async () => body,
  } as unknown as import('next/server').NextRequest;
}

function smtpConfig() {
  Object.assign(configValues, {
    forgotPasswordEnabled: true,
    resetSmtpHost: 'smtp.example.com',
    resetSmtpUser: 'user',
    resetSmtpPass: 'pass',
    resetFromEmail: 'no-reply@example.com',
    resetAppBaseUrl: 'https://example.com',
    stalwartAdminApiUrl: 'https://stalwart.example.com',
    stalwartAdminApiToken: 'admin-token',
    jmapServerUrl: 'https://jmap.example.com',
    resetSmtpPort: '587',
    resetSmtpSecure: false,
    appName: 'TestMail',
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset configValues to a clean state
    for (const k of Object.keys(configValues)) delete configValues[k];
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 5, retryAfterMs: 0 });
    mockCreateResetToken.mockResolvedValue({ token: 'test-token-abc' });
    mockSendPasswordResetEmail.mockReset();
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockGetRecoveryEmail.mockReturnValue(null);
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'], recoveryEmail: undefined,
    });
  });

  it('returns 404 when forgotPasswordEnabled is false', async () => {
    configValues.forgotPasswordEnabled = false;
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(404);
  });

  it('returns ok() (not noRecoveryEmail) when IP is rate-limited', async () => {
    smtpConfig();
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 60000 });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    const data = await res.json();
    // Should NOT reveal rate-limit — just return ok
    expect(data.noRecoveryEmail).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it('returns {noRecoveryEmail:true} for unknown user (anti-enumeration)', async () => {
    smtpConfig();
    mockGetStalwartPrincipal.mockResolvedValue(null as any); // user not found
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'nobody@example.com' }));
    const data = await res.json();
    expect(data).toEqual({ noRecoveryEmail: true });
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns {noRecoveryEmail:true} when user exists but no recovery email', async () => {
    smtpConfig();
    // Principal has only their own mailbox email, no separate recovery address
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'], recoveryEmail: undefined,
    });
    mockGetRecoveryEmail.mockReturnValue(null); // no local store entry either
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    const data = await res.json();
    expect(data).toEqual({ noRecoveryEmail: true });
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mockCreateResetToken).not.toHaveBeenCalled();
  });

  it('sends email and returns ok() when Stalwart recoveryEmail is set', async () => {
    smtpConfig();
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual',
      emails: ['alice@example.com'],
      recoveryEmail: 'alice-backup@gmail.com',
    });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'alice-backup@gmail.com' })
    );
  });

  it('sends email and returns ok() when local recovery-email store has entry', async () => {
    smtpConfig();
    mockGetRecoveryEmail.mockReturnValue('alice-local@recover.io');
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'alice-local@recover.io' })
    );
  });

  it('local recovery-email store takes priority over Stalwart recoveryEmail', async () => {
    smtpConfig();
    mockGetRecoveryEmail.mockReturnValue('local@recover.io');
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'],
      recoveryEmail: 'stalwart@recover.io',
    });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    await POST(makeRequest({ email: 'alice@example.com' }));
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'local@recover.io' })
    );
  });

  it('does NOT fall back to principal.emails[0] (the locked-out mailbox)', async () => {
    smtpConfig();
    mockGetRecoveryEmail.mockReturnValue(null);
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual',
      emails: ['alice@example.com'], // their own locked-out address
      recoveryEmail: undefined,
    });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    const data = await res.json();
    // Must NOT send to their own mailbox
    expect(data).toEqual({ noRecoveryEmail: true });
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('accepts "username" field as an alias for "email"', async () => {
    smtpConfig();
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'],
      recoveryEmail: 'alice-bak@gmail.com',
    });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ username: 'alice@example.com' }));
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('returns ok() without sending email when SMTP config is incomplete', async () => {
    // Only enable the feature but leave SMTP unconfigured
    configValues.forgotPasswordEnabled = true;
    // principal with recovery email — but SMTP missing → should still return ok()
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'],
      recoveryEmail: 'bak@gmail.com',
    });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: 'alice@example.com' }));
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns 400 for empty username/email', async () => {
    smtpConfig();
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const res = await POST(makeRequest({ email: '' }));
    expect(res.status).toBe(400);
  });

  it('includes the reset link in the email with the generated token', async () => {
    smtpConfig();
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'],
      recoveryEmail: 'bak@gmail.com',
    });
    const { POST } = await import('@/app/api/auth/forgot-password/route');
    await POST(makeRequest({ email: 'alice@example.com' }));
    const opts = (mockSendPasswordResetEmail.mock.calls[0] as any[])[0] as { resetLink: string };
    expect(opts.resetLink).toContain('test-token-abc');
  });
});
