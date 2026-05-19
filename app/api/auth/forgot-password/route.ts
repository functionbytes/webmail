import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { checkResetRateLimit } from '@/lib/auth/reset-rate-limit';
import { createResetToken } from '@/lib/auth/password-reset-store';
import { sendPasswordResetEmail, type SmtpConfig } from '@/lib/auth/password-reset-mailer';

/** Always return the same shape to prevent email enumeration. */
const OK = NextResponse.json({ ok: true });

export async function POST(request: NextRequest) {
  try {
    await configManager.ensureLoaded();

    // Feature flag
    const enabled = configManager.get<boolean>('forgotPasswordEnabled', false);
    if (!enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // IP rate-limit
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const { allowed } = checkResetRateLimit(ip);
    if (!allowed) {
      logger.warn('Forgot-password rate limited', { ip });
      // Return OK to avoid revealing that the IP is blocked
      return OK;
    }

    const body = await request.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
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
      // Return OK — the admin needs to configure the feature, but we don’t
      // expose that to the caller.
      return OK;
    }

    // Resolve the JMAP server URL for this user (used so the reset page can
    // call the right server to verify the new credential afterwards).
    const serverUrl = configManager.get<string>('jmapServerUrl', '');

    const result = createResetToken(username, serverUrl);
    if (!result) {
      // User not found in token store — return OK (anti-enumeration)
      return OK;
    }
    if ('rateLimited' in result) {
      logger.info('Forgot-password per-user rate limited', { username });
      return OK;
    }

    const smtpPortRaw = configManager.get<string>('resetSmtpPort', '587');
    const smtpSecure = configManager.get<boolean>('resetSmtpSecure', false);
    const appName = configManager.get<string>('appName', 'Webmail');

    const resetLink = `${appBaseUrl.replace(/\/$/, '')}/reset-password?token=${result.token}`;

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
      toEmail: username,
      username,
      resetLink,
      appName,
    });

    return OK;
  } catch (error) {
    logger.error('Forgot-password error', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Do not leak internals
    return OK;
  }
}
