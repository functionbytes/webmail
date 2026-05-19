import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { configManager } from '@/lib/admin/config-manager';
import { consumeResetToken } from '@/lib/auth/password-reset-store';
import { setStalwartPassword } from '@/lib/auth/stalwart-admin';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  try {
    await configManager.ensureLoaded();

    const forgotPasswordEnabled = configManager.get<boolean>('forgotPasswordEnabled', false);
    if (!forgotPasswordEnabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!token) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
    }

    const credential = await consumeResetToken(token);
    if (!credential) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    }

    const adminApiUrl = configManager.get<string>('stalwartAdminApiUrl', '');
    const adminToken = configManager.get<string>('stalwartAdminApiToken', '');
    if (!adminApiUrl || !adminToken) {
      logger.error('reset-password: Stalwart admin API not configured');
      return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }

    await setStalwartPassword(adminApiUrl, adminToken, credential.username, password);

    logger.info('reset-password: password updated', { username: credential.username });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('reset-password error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
