/**
 * Tests for app/api/admin/invite-user/route.ts
 *
 * Key behaviours:
 *  - 401 without admin auth
 *  - 400 for missing username
 *  - 404 when user not found in Stalwart
 *  - 422 when no email can be resolved (username-only, no @)
 *  - Sends invite (isInvite:true) when recovery email found
 *  - 429 when rate limited
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}));

// ── Admin auth ────────────────────────────────────────────────────────────────
// requireAdminAuth returns { payload } on success or { error: NextResponse } on failure
const mockRequireAdminAuth = vi.fn(async () => ({ payload: { username: 'admin' } }));
vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: (...a: unknown[]) => (mockRequireAdminAuth as any)(...a),
}));

// ── configManager ─────────────────────────────────────────────────────────────
const configValues: Record<string, unknown> = {};
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(),
    get: vi.fn((key: string, def: unknown) => configValues[key] ?? def),
  },
}));

// ── Stalwart admin ────────────────────────────────────────────────────────────
const mockGetStalwartPrincipal = vi.fn(async () => ({
  name: 'alice', type: 'individual',
  emails: ['alice@example.com'],
  recoveryEmail: undefined as string | undefined,
}));
const mockResolveResetEmail = vi.fn((_principal: unknown, username: string) => username);
vi.mock('@/lib/auth/stalwart-admin', () => ({
  getStalwartPrincipal: (...a: unknown[]) => (mockGetStalwartPrincipal as any)(...a),
  resolveResetEmail: (...a: unknown[]) => (mockResolveResetEmail as any)(...a),
}));

// ── Recovery email store ──────────────────────────────────────────────────────
const mockGetRecoveryEmail = vi.fn((_u: string): string | null => null);
vi.mock('@/lib/auth/recovery-email-store', () => ({
  getRecoveryEmail: (u: string) => mockGetRecoveryEmail(u),
}));

// ── Token store ───────────────────────────────────────────────────────────────
const mockCreateResetToken = vi.fn(async () => ({ token: 'invite-token-xyz' }));
vi.mock('@/lib/auth/password-reset-store', () => ({
  createResetToken: (...a: unknown[]) => (mockCreateResetToken as any)(...a),
}));

// ── Mailer ────────────────────────────────────────────────────────────────────
const mockSendPasswordResetEmail = vi.fn(async () => undefined);
vi.mock('@/lib/auth/password-reset-mailer', () => ({
  sendPasswordResetEmail: (...a: unknown[]) => (mockSendPasswordResetEmail as any)(...a),
}));

// ── Rate limiter ──────────────────────────────────────────────────────────────
const mockCheckRateLimit = vi.fn(() => ({ allowed: true, remaining: 5, retryAfterMs: 0 }));
vi.mock('@/lib/auth/reset-rate-limit', () => ({ checkResetRateLimit: (...a: unknown[]) => (mockCheckRateLimit as any)(...a) }));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>, ip = '10.0.0.1') {
  return {
    headers: { get: (h: string) => (h === 'x-forwarded-for' ? ip : null) },
    json: async () => body,
  } as unknown as import('next/server').NextRequest;
}

function setupSmtp() {
  Object.assign(configValues, {
    resetSmtpHost: 'smtp.example.com',
    resetSmtpUser: 'u',
    resetSmtpPass: 'p',
    resetFromEmail: 'no-reply@example.com',
    resetAppBaseUrl: 'https://example.com',
    stalwartAdminApiUrl: 'https://stalwart.example.com',
    stalwartAdminApiToken: 'tok',
    jmapServerUrl: 'https://jmap.example.com',
    resetSmtpPort: '587',
    resetSmtpSecure: false,
    appName: 'TestMail',
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/invite-user', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(configValues)) delete configValues[k];
    mockRequireAdminAuth.mockResolvedValue({ payload: { username: 'admin' } }); // authenticated
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 5, retryAfterMs: 0 });
    mockCreateResetToken.mockReset();
    mockCreateResetToken.mockResolvedValue({ token: 'invite-token-xyz' });
    mockSendPasswordResetEmail.mockReset();
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockGetRecoveryEmail.mockReturnValue(null);
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'alice', type: 'individual', emails: ['alice@example.com'], recoveryEmail: undefined,
    });
    mockResolveResetEmail.mockImplementation((_p, username) => username);
  });

  it('returns 401 when admin auth fails', async () => {
    // requireAdminAuth returns { error: NextResponse } when unauthorized
    mockRequireAdminAuth.mockResolvedValue({
      error: { status: 401, json: async () => ({ error: 'Unauthorized' }) },
    } as any);
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({ username: 'alice' }));
    expect(res.status).toBe(401);
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns 400 for missing username', async () => {
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found in Stalwart', async () => {
    setupSmtp();
    mockGetStalwartPrincipal.mockResolvedValue(null as any);
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({ username: 'ghost' }));
    expect(res.status).toBe(404);
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('returns 422 when resolved email has no @ (username-only, not a real email)', async () => {
    setupSmtp();
    mockGetStalwartPrincipal.mockResolvedValue({
      name: 'sysuser', type: 'individual', emails: [], recoveryEmail: undefined,
    });
    mockGetRecoveryEmail.mockReturnValue(null);
    mockResolveResetEmail.mockReturnValue('sysuser'); // no @ character
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({ username: 'sysuser' }));
    expect(res.status).toBe(422);
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('sends invite email with isInvite:true when local recovery email found', async () => {
    setupSmtp();
    mockGetRecoveryEmail.mockReturnValue('alice-bak@gmail.com');
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({ username: 'alice' }));
    expect(res.status).toBe(200);
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'alice-bak@gmail.com', isInvite: true })
    );
  });

  it('falls back to resolveResetEmail when local store has no entry', async () => {
    setupSmtp();
    mockGetRecoveryEmail.mockReturnValue(null);
    mockResolveResetEmail.mockReturnValue('alice@example.com');
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({ username: 'alice' }));
    expect(res.status).toBe(200);
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: 'alice@example.com', isInvite: true })
    );
  });

  it('returns 429 when rate limited', async () => {
    setupSmtp();
    mockCreateResetToken.mockResolvedValue({ rateLimited: true } as any);
    mockGetRecoveryEmail.mockReturnValue('bak@gmail.com');
    const { POST } = await import('@/app/api/admin/invite-user/route');
    const res = await POST(makeRequest({ username: 'alice' }));
    expect(res.status).toBe(429);
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('include the invite token in the reset link', async () => {
    setupSmtp();
    mockGetRecoveryEmail.mockReturnValue('bak@gmail.com');
    const { POST } = await import('@/app/api/admin/invite-user/route');
    await POST(makeRequest({ username: 'alice' }));
    const opts = (mockSendPasswordResetEmail.mock.calls[0] as any[])[0] as { resetLink: string };
    expect(opts.resetLink).toContain('invite-token-xyz');
  });
});
