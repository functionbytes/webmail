import type { NextRequest } from 'next/server';

/**
 * Lightweight CSRF defense for state-changing routes.
 *
 * Browsers always send the `Origin` header on cross-origin and CORS
 * requests (and on same-origin POST/PUT/DELETE). If `Origin` is present
 * it MUST match the request `Host`. Missing `Origin` is allowed because:
 *   • same-origin GET / HEAD requests may omit it, and
 *   • server-to-server callers (curl, internal scripts) legitimately omit it.
 *
 * This is intentionally minimal and used as a second layer behind the
 * default `SameSite=lax` session cookie.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
