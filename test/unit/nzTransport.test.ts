import { describe, expect, it } from 'vitest';
import { looksLikeChallenge } from '@main/providers/nz/transport/NzTransport';

// Taken from a real response observed at nz.ua on 2026-09-16.
const CF_CHALLENGE = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
<meta http-equiv="content-security-policy" content="script-src 'nonce-x' https://challenges.cloudflare.com">`;

describe('looksLikeChallenge', () => {
  it('recognizes the Cloudflare interstitial nz.ua actually serves', () => {
    expect(looksLikeChallenge(403, CF_CHALLENGE, 'text/html; charset=UTF-8')).toBe(true);
  });

  it('recognizes it on 503 and 429 too', () => {
    expect(looksLikeChallenge(503, CF_CHALLENGE, 'text/html')).toBe(true);
    expect(looksLikeChallenge(429, CF_CHALLENGE, 'text/html')).toBe(true);
  });

  it('does not mistake a JSON error for a challenge', () => {
    // A genuine 403 from the app must be reported as AUTH, not as a bot check.
    expect(looksLikeChallenge(403, '{"error":"forbidden"}', 'application/json')).toBe(false);
  });

  it('does not flag an ordinary HTML page', () => {
    expect(looksLikeChallenge(200, '<html><body>Розклад</body></html>', 'text/html')).toBe(false);
  });

  it('does not flag an HTML error page that is not a challenge', () => {
    expect(looksLikeChallenge(403, '<html><body>Access denied</body></html>', 'text/html')).toBe(false);
  });
});
