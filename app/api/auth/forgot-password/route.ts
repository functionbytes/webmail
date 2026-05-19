import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { checkResetRateLimit } from '@/lib/auth/reset-rate-limit';
import { createResetToken } from '@/lib/auth/password-reset-store';
import { sendPasswordResetEmail, type SmtpConfig } from '@/lib/auth/password-reset-mailer';

export async function POST(request: NextRequest) {
  try {
    await configManager.ensureLoaded();

    const forgotPasswordEnabled = configManager.get<boolean>('forgotPasswordEnabled', false);
    if (!forgotPasswordEnabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // IP-based rate limiting (same pattern as admin login)
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const { allowed } = checkResetRateLimit(ip);
    if (!allowed) {
      // Return ok:true to avoid disclosing whether an account exists
      return NextResponse.json({ ok: true });
    }

    const body = await request.json();
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    if (!username) {
      return NextResponse.json({ error: 'Missing username' }, { status: 400 });
    }

    const smtpHost = configManager.get<string>('resetSmtpHost', '');
    const smtpUser = configManager.get<string>('resetSmtpUser', '');
    const smtpPass = configManager.get<string>('resetSmtpPass', '');
    const fromEmail = configManager.get<string>('resetFromEmail', '');
    const appBaseUrl = configManager.get<string>('resetAppBaseUrl', '');
    const stalwartApiUrl = configManager.get<string>('stalwartAdminApiUrl', '');
    const appName = configManager.get<string>('appName', 'Webmail');

    if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !stalwartApiUrl) {
      logger.warn('forgot-password: SMTP or Stalwart admin API not fully configured');
      // Still respond ok:true — misconfiguration must not leak info
      return NextResponse.json({ ok: true });
    }

    const serverUrl = configManager.get<string>('jmapServerUrl', '');
    const result = await createResetToken(username, serverUrl);

    // Always respond ok:true regardless of whether the account exists (anti-enumeration)
    if (!result || 'rateLimited' in result) {
      return NextResponse.json({ ok: true });
    }

    const baseUrl =
      appBaseUrl ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(result.token)}`;

    const smtp: SmtpConfig = {
      host: smtpHost,
      port: Number(configManager.get<string>('resetSmtpPort', '587')),
      secure: configManager.get<boolean>('resetSmtpSecure', false),
      user: smtpUser,
      pass: smtpPass,
      from: fromEmail,
    };

    // Derive recipient address: use username directly if it contains @,
    // otherwise assume it is the local part and append the from-address domain.
    const toEmail = username.includes('@')
      ? username
      : `${username}@${fromEmail.split('@')[1] ?? ''}`;

    await sendPasswordResetEmail({ smtp, toEmail, username, resetLink, appName });

    logger.info('forgot-password: reset email sent', { username });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('forgot-password error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Never leak details to the client
    return NextResponse.json({ ok: true });
  }
}
