export interface NzRequest {
  /** Path relative to the nz.ua origin, e.g. '/api/v1/schedule'. */
  path: string;
  method?: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface NzRawResponse {
  status: number;
  /** Raw body text. Parsing and validation happen above the transport. */
  body: string;
  contentType: string;
  /** True when the body is a bot-check interstitial rather than real content. */
  challenged: boolean;
  /** Seconds the server asked us to wait, when it said so. */
  retryAfterSeconds?: number;
}

export type NzSessionState = 'ok' | 'login_required' | 'blocked';

/**
 * How requests reach nz.ua.
 *
 * Abstracted because nz.ua sits behind Cloudflare's interactive challenge
 * (`cf-mitigated: challenge`), which no plain HTTP client can pass — so the real
 * implementation has to drive a browser, and tests need to not do that.
 */
export interface NzTransport {
  readonly kind: 'browser-session' | 'http' | 'fixture';
  /** Non-destructive check; never opens UI of its own accord. */
  ensureSession(): Promise<NzSessionState>;
  request(req: NzRequest): Promise<NzRawResponse>;
  dispose(): Promise<void>;
}

/** Cloudflare's challenge pages are recognisable without parsing them properly. */
export function looksLikeChallenge(status: number, body: string, contentType: string): boolean {
  if (!contentType.includes('text/html')) return false;
  if (status !== 403 && status !== 503 && status !== 429) return false;
  return (
    body.includes('Just a moment') ||
    body.includes('challenges.cloudflare.com') ||
    body.includes('cf-browser-verification') ||
    body.includes('cf_chl')
  );
}
