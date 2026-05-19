/**
 * Per-IP rate limiter for the forgot-password endpoint.
 * Uses an in-process Map — resets on server restart (intentional: this is just
 * a lightweight abuse guard, not a persistent quota).
 */

const WINDOW_MS   = 15 * 60 * 1000; // 15-minute fixed window
const MAX_REQUESTS = 5;              // per IP per window

interface Entry {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Entry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkResetRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  let entry = buckets.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    buckets.set(ip, entry);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.count += 1;
  buckets.set(ip, entry);
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, retryAfterMs: 0 };
}
