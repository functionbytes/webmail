import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession } from '@/lib/auth/crypto';
import { SESSION_COOKIE } from '@/lib/auth/session-cookie';
import { getRecoveryEmail, setRecoveryEmail, deleteRecoveryEmail } from '@/lib/auth/recovery-email-store';
import { isSameOrigin } from '@/lib/auth/csrf';
import { logger } from '@/lib/logger';

async function getSession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return decryptSession(raw);
}

/** GET /api/account/recovery-email — returns the current recovery email */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = getRecoveryEmail(session.username);
  return NextResponse.json({ email });
}

/** PUT /api/account/recovery-email — set or clear recovery email */
export async function PUT(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const email: unknown = body?.email;

  if (email === null || email === '' || email === undefined) {
    // Allow clearing the recovery email
    try {
      await deleteRecoveryEmail(session.username);
    } catch {
      return NextResponse.json({ error: 'Failed to clear recovery email' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (typeof email !== 'string') {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  // Validate: no control characters, basic email shape
  if (/[\r\n\0]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
  }

  // Prevent setting recovery email = login address (pointless — that's what we
  // already fall back to when no recovery email is configured)
  if (email.toLowerCase() === session.username.toLowerCase()) {
    return NextResponse.json(
      { error: 'Recovery email must differ from your login address' },
      { status: 400 },
    );
  }

  try {
    await setRecoveryEmail(session.username, email);
  } catch {
    return NextResponse.json({ error: 'Failed to save recovery email' }, { status: 500 });
  }
  logger.info('Recovery email set via API', { username: session.username });
  return NextResponse.json({ ok: true });
}
