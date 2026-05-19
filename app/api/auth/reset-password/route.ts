import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { getClientIP } from '@/lib/admin/session';
import { checkResetRateLimit } from '@/lib/auth/reset-rate-limit';
import { consumeResetToken, markTokenUsed } from '@/lib/auth/password-reset-store';
import { setStalwartPassword } from '@/lib/auth/stalwart-admin';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  try {
    await configManager.ensureLoaded();

    const enabled = configManager.get<boolean>('forgotPasswordEnabled', false);
    if (!enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // IP rate-limit (shared bucket with forgot-password)
    const ip = getClientIP(request);
    const { allowed } = checkResetRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

    if (!token) {
      return NextResponse.json({ error: 'missing_token' }, { status: 400 });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
    }

    // Step 1: Validate token WITHOUT consuming it yet
    const tokenData = consumeResetToken(token);
    if (!tokenData) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    }

    const stalwartApiUrl = configManager.get<string>('stalwartAdminApiUrl', '');
    const stalwartToken = configManager.get<string>('stalwartAdminApiToken', '');

    if (!stalwartApiUrl || !stalwartToken) {
      logger.error('Reset-password: Stalwart admin API not configured');
      return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 });
    }

    // Step 2: Update the password
    await setStalwartPassword(
      stalwartApiUrl,
      stalwartToken,
      tokenData.username,
      newPassword,
    );

    // Step 3: Mark the token as used ONLY after the password update succeeded
    markTokenUsed(token);

    logger.info('Password reset completed', { username: tokenData.username });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('Reset-password error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
