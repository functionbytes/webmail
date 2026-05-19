/**
 * Stalwart Management API helpers.
 *
 * Requires an admin Bearer token with permission to update principals.
 * Configure via STALWART_ADMIN_API_URL + STALWART_ADMIN_API_TOKEN env vars.
 *
 * API reference:
 *   PATCH /api/principal/{username}
 *   Body: [{ "action": "set", "field": "secret", "value": "<password>" }]
 */
export async function setStalwartPassword(
  adminApiUrl: string,
  adminToken: string,
  username: string,
  newPassword: string,
): Promise<void> {
  const url = `${adminApiUrl.replace(/\/$/, '')}/api/principal/${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ action: 'set', field: 'secret', value: newPassword }]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stalwart API error ${res.status}: ${text}`);
  }
}
