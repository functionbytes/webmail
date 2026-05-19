import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/session';
import { configManager } from '@/lib/admin/config-manager';
import { createResetToken } from '@/lib/auth/password-reset-store';
import { sendPasswordResetEmail, type SmtpConfig } from '@/lib/auth/password-reset-mailer';
import { getStalwartPrincipal, resolveResetEmail } from '@/lib/auth/stalwart-admin';
import { getRecoveryEmail } from '@/lib/auth/recovery-email-store';
import { isSameOrigin } from '@/lib/auth/csrf';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/invite-user
 *
 * Sends an invitation email to a user's recovery address so they can set their
 * initial (or new) password. Requires an active admin session.
 *
 * Body: { username: string }
 *
 * Returns:
 *   200 { ok: true }             — invite sent
 *   400 { error: string }        — bad input or incomplete SMTP config
 *   401 / 403                    — not authenticated as admin
 *   404 { error: string }        — user not found in Stalwart
 *   422 { error: string }        — user has no recovery email configured
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const auth = await requireAdminAuth(request);
    if ('error' in auth) return auth.error;

    await configManager.ensureLoaded();

    const body = await request.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    if (!username) {
      return NextResponse.json({ error: 'Missing username' }, { status: 400 });
    }

    // Require SMTP + Stalwart admin API to be configured
    const smtpHost      = configManager.get<string>('resetSmtpHost', '');
    const smtpUser      = configManager.get<string>('resetSmtpUser', '');
    const smtpPass      = configManager.get<string>('resetSmtpPass', '');
    const fromEmail     = configManager.get<string>('resetFromEmail', '');
    const appBaseUrl    = configManager.get<string>('resetAppBaseUrl', '');
    const stalwartApiUrl = configManager.get<string>('stalwartAdminApiUrl', '');
    const stalwartToken  = configManager.get<string>('stalwartAdminApiToken', '');

    if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !appBaseUrl || !stalwartApiUrl || !stalwartToken) {
      return NextResponse.json(
        { error: 'Email delivery is not configured. Set SMTP and Stalwart admin settings first.' },
        { status: 400 },
      );
    }

    // Verify the user exists in Stalwart
    let principal = null;
    try {
      principal = await getStalwartPrincipal(stalwartApiUrl, stalwartToken, username);
    } catch (err) {
      logger.warn('Invite-user: Stalwart unreachable', { username, err });
      return NextResponse.json({ error: 'Could not reach mail server.' }, { status: 502 });
    }

    if (!principal) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // Resolve recovery email: local store first, then Stalwart principal
    const toEmail = getRecoveryEmail(username) ?? resolveResetEmail(principal, username);

    // resolveResetEmail falls back to the username itself — reject that case
    // because username is typically not a deliverable external address and
    // the admin should be prompted to configure one.
    if (toEmail === username && !toEmail.includes('@')) {
      return NextResponse.json(
        { error: 'No recovery email is set for this user. Ask them to add one in Settings → Security, or set one in Stalwart.' },
        { status: 422 },
      );
    }

    // Create the invite token (same store / TTL as password-reset)
    const serverUrl = configManager.get<string>('jmapServerUrl', '');
    const result = await createResetToken(username, serverUrl);
    if ('rateLimited' in result) {
      return NextResponse.json(
        { error: 'An invite was already sent recently. Please wait before sending another.' },
        { status: 429 },
      );
    }

    const smtpPortRaw = configManager.get<string>('resetSmtpPort', '587');
    const smtpSecure  = configManager.get<boolean>('resetSmtpSecure', false);
    const appName     = configManager.get<string>('appName', 'Webmail');
    const inviteLink  = `${appBaseUrl.replace(/\/$/, '')}/en/reset-password?token=${result.token}`;

    const smtp: SmtpConfig = {
      host:   smtpHost,
      port:   parseInt(smtpPortRaw, 10) || 587,
      secure: smtpSecure,
      user:   smtpUser,
      pass:   smtpPass,
      from:   fromEmail,
    };

    await sendPasswordResetEmail({
      smtp,
      toEmail,
      username,
      resetLink: inviteLink,
      appName,
      isInvite: true,
    });

    logger.info('Admin sent user invite', { username, toEmail });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('Invite-user error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
