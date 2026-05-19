import { logger } from '@/lib/logger';

/**
 * Stalwart principal as returned by GET /api/principal/{username}.
 * Only the fields we care about are typed here.
 */
export interface StalwartPrincipal {
  name: string;
  type: string;
  emails: string[];
  /** Custom field — set via account settings if recovery email feature is used. */
  recoveryEmail?: string;
}

/**
 * Fetch a Stalwart principal by username.
 * Returns null if the principal is not found (404) so callers can handle
 * anti-enumeration themselves.
 */
export async function getStalwartPrincipal(
  adminApiUrl: string,
  adminToken: string,
  username: string,
): Promise<StalwartPrincipal | null> {
  const base = adminApiUrl.replace(/\/$/, '');
  const url = `${base}/api/principal/${encodeURIComponent(username)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.warn('Stalwart get-principal failed', { username, status: res.status, body });
    throw new Error(`Stalwart API returned ${res.status}`);
  }

  return (await res.json()) as StalwartPrincipal;
}

/**
 * Resolve the best email address to send a password-reset link to.
 *
 * Priority:
 *  1. principal.recoveryEmail  (user-configured recovery address)
 *  2. principal.emails[0]      (primary address registered in Stalwart)
 *  3. username                 (fallback — works when username IS the email)
 */
export function resolveResetEmail(
  principal: StalwartPrincipal | null,
  username: string,
): string {
  if (principal?.recoveryEmail) return principal.recoveryEmail;
  if (principal?.emails?.length) return principal.emails[0];
  return username;
}

/**
 * Update a Stalwart account password via the Management API.
 *
 * Requires an admin Bearer token with `principal/set` permission.
 * Endpoint: PATCH /api/principal/{username}
 * Body: [{"action":"set","field":"secret","value":"<newpassword>"}]
 */
export async function setStalwartPassword(
  adminApiUrl: string,
  adminToken: string,
  username: string,
  newPassword: string,
): Promise<void> {
  const base = adminApiUrl.replace(/\/$/, '');
  const url = `${base}/api/principal/${encodeURIComponent(username)}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ action: 'set', field: 'secret', value: newPassword }]),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.warn('Stalwart password update failed', { username, status: res.status, body });
    throw new Error(`Stalwart API returned ${res.status}`);
  }

  logger.info('Stalwart password updated via admin API', { username });
}
