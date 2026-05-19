import { logger } from '@/lib/logger';

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
