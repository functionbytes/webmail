import { describe, it, expect } from 'vitest';
import { isSameOrigin } from '../csrf';

function req(headers: Record<string, string>) {
  // Minimal duck-typed NextRequest: only headers.get() is used.
  return {
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? null,
    },
  } as unknown as import('next/server').NextRequest;
}

describe('isSameOrigin', () => {
  it('allows requests without an Origin header (server-to-server, same-origin GET)', () => {
    expect(isSameOrigin(req({ host: 'mail.example.com' }))).toBe(true);
  });

  it('allows requests where Origin host matches Host', () => {
    expect(
      isSameOrigin(
        req({ origin: 'https://mail.example.com', host: 'mail.example.com' }),
      ),
    ).toBe(true);
  });

  it('rejects cross-origin requests', () => {
    expect(
      isSameOrigin(
        req({ origin: 'https://evil.example.com', host: 'mail.example.com' }),
      ),
    ).toBe(false);
  });

  it('rejects when Origin is malformed', () => {
    expect(
      isSameOrigin(req({ origin: 'not-a-url', host: 'mail.example.com' })),
    ).toBe(false);
  });

  it('rejects when Origin is present but Host is missing', () => {
    expect(isSameOrigin(req({ origin: 'https://mail.example.com' }))).toBe(false);
  });

  it('matches Origin including port', () => {
    expect(
      isSameOrigin(
        req({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        req({ origin: 'http://localhost:4000', host: 'localhost:3000' }),
      ),
    ).toBe(false);
  });
});
