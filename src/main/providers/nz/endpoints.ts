/**
 * nz.ua endpoint configuration.
 *
 * nz.ua publishes no API documentation, and its endpoints cannot be reached from a
 * datacenter IP to inspect — every request returns Cloudflare's interactive
 * challenge. Rather than ship invented paths that would look authoritative and
 * silently never work, the paths start empty and are filled in from a discovery
 * run on the user's own machine (Settings -> Diagnostics -> "Знайти endpoints",
 * see docs/NZ_INTEGRATION.md).
 *
 * Anything not yet discovered is reported as an unsupported capability, so the UI
 * says "no timetable source" rather than showing an empty timetable that looks like
 * a real answer.
 */

export const NZ_ORIGIN = 'https://nz.ua';

/** Substrings that mean the browser landed on a sign-in page rather than the app. */
export const NZ_LOGIN_PATH_HINTS = ['/login', '/signin', '/auth', '/user/login'];

export interface NzEndpointConfig {
  /** Timetable for a date range. */
  schedule: string | null;
  /** Homework / assigned work. */
  homework: string | null;
  /** Grades from the journal. */
  grades: string | null;
  /** The signed-in user, used to confirm the session is live. */
  profile: string | null;
  /** Query parameter names this deployment expects, once observed. */
  params: {
    dateFrom: string;
    dateTo: string;
  };
}

export const EMPTY_ENDPOINTS: NzEndpointConfig = {
  schedule: null,
  homework: null,
  grades: null,
  profile: null,
  params: { dateFrom: 'start_date', dateTo: 'end_date' },
};

export function isConfigured(config: NzEndpointConfig): boolean {
  return Boolean(config.schedule ?? config.homework);
}

/**
 * Whether a recorded request looks like an application data call worth keeping,
 * as opposed to analytics, fonts or Cloudflare's own traffic.
 */
export function isInterestingEndpoint(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Exact host or a real subdomain — a bare endsWith would also match 'evilnz.ua'.
  const host = parsed.hostname.toLowerCase();
  if (host !== 'nz.ua' && !host.endsWith('.nz.ua')) return false;

  const path = parsed.pathname.toLowerCase();
  if (/\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|webp)$/.test(path)) return false;
  if (path.startsWith('/cdn-cgi/')) return false;

  return true;
}
