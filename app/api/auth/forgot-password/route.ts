import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { getClientIP } from '@/lib/admin/session';
import { checkResetRateLimit } from '@/lib/auth/reset-rate-limit';
import { createResetToken } from '@/lib/auth/password-reset-store';
import { sendPasswordResetEmail, type SmtpConfig } from '@/lib/auth/password-reset-mailer';
import { getStalwartPrincipal } from '@/lib/auth/stalwart-admin';
import { getRecoveryEmail } from '@/lib/auth/recovery-email-store';

/** Factory — always returns a fresh Response (body is a single-use stream). */
const ok = () => NextResponse.json({ ok: true });

export async function POST(request: NextRequest) {
  try {
    await configManager.ensureLoaded();

    // Feature flag
    const enabled = configManager.get<boolean>('forgotPasswordEnabled', false);
    if (!enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // IP rate-limit
    const ip = getClientIP(request);
    const { allowed } = checkResetRateLimit(ip);
    if (!allowed) {
      logger.warn('Forgot-password rate limited', { ip });
      // Return OK to avoid revealing that the IP is blocked
      return ok();
    }

    const body = await request.json().catch(() => null);
    // Accept either "username" or "email" — in Stalwart the login username is
    // typically the email address, so both fields map to the same principal lookup.
    const raw = body?.email ?? body?.username;
    const username = typeof raw === 'string' ? raw.trim() : '';
    if (!username) {
      return NextResponse.json({ error: 'Missing username' }, { status: 400 });
    }

    // Require SMTP + admin API to be configured before doing anything
    const smtpHost = configManager.get<string>('resetSmtpHost', '');
    const smtpUser = configManager.get<string>('resetSmtpUser', '');
    const smtpPass = configManager.get<string>('resetSmtpPass', '');
    const fromEmail = configManager.get<string>('resetFromEmail', '');
    const appBaseUrl = configManager.get<string>('resetAppBaseUrl', '');
    const stalwartApiUrl = configManager.get<string>('stalwartAdminApiUrl', '');
    const stalwartToken = configManager.get<string>('stalwartAdminApiToken', '');

    if (
      !smtpHost ||
      !smtpUser ||
      !smtpPass ||
      !fromEmail ||
      !appBaseUrl ||
      !stalwartApiUrl ||
      !stalwartToken
    ) {
      logger.warn('Forgot-password: incomplete server configuration, request ignored', {
        username,
      });
      return ok();
    }

    // ── Recovery email: look up the principal in Stalwart ──────────────────
    // This also implicitly verifies the user exists; we still return ok() either
    // way to prevent enumeration — but we skip token creation for unknown users.
    let principal = null;
    try {
      principal = await getStalwartPrincipal(stalwartApiUrl, stalwartToken, username);
    } catch {
      // Stalwart unavailable — fail silently (anti-enumeration)
      logger.warn('Forgot-password: could not reach Stalwart, request ignored', { username });
      return ok();
    }

    if (!principal) {
      // Unknown user — treat identically to "no recovery email" so the client
      // prompt is the same and the distinction is not leaked (anti-enumeration).
      return NextResponse.json({ noRecoveryEmail: true });
    }

    // Resolve recovery email: only accept an address that is *not* the locked-out
    // mailbox itself.  We intentionally skip principal.emails[0] because that is
    // the webmail address the user cannot access when they've forgotten their
    // password.  Only a separately-configured recovery address is useful here.
    const toEmail = getRecoveryEmail(username) ?? principal.recoveryEmail ?? null;

    if (!toEmail) {
      // Principal exists but no recovery email is configured.
      return NextResponse.json({ noRecoveryEmail: true });
    }

    // Resolve the JMAP server URL for this user
    const serverUrl = configManager.get<string>('jmapServerUrl', '');

    const result = await createResetToken(username, serverUrl);
    if ('rateLimited' in result) {
      logger.info('Forgot-password per-user rate limited', { username });
      return ok();
    }

    const smtpPortRaw = configManager.get<string>('resetSmtpPort', '587');
    const smtpSecure = configManager.get<boolean>('resetSmtpSecure', false);
    const appName = configManager.get<string>('appName', 'Webmail');

    const resetLink = `${appBaseUrl.replace(/\/$/, '')}/en/reset-password?token=${result.token}`;

    const smtp: SmtpConfig = {
      host: smtpHost,
      port: parseInt(smtpPortRaw, 10) || 587,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      from: fromEmail,
    };

    await sendPasswordResetEmail({
      smtp,
      toEmail,
      username,
      resetLink,
      appName,
    });

    return ok();
  } catch (error) {
    logger.error('Forgot-password error', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Do not leak internals
    return ok();
  }
}
