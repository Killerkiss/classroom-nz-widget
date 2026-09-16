import type { BrowserWindow } from 'electron';
import { log } from '@main/logging';
import { isInterestingEndpoint } from './endpoints';

export interface DiscoveredEndpoint {
  method: string;
  /** Path only. Query values are dropped — they contain the student's identifiers. */
  path: string;
  /** Parameter names observed, without their values. */
  paramNames: string[];
  count: number;
  contentType?: string;
  status?: number;
}

/**
 * Records which data requests the real nz.ua web app makes, so the integration can
 * be built against observed endpoints rather than guesses.
 *
 * Only the user can run this: it needs their logged-in browser session, and nz.ua
 * cannot be reached from anywhere else. The report deliberately keeps **names
 * only** — no query values, no request bodies, no responses — because those carry
 * the student's identifiers, class roster and grades.
 */
export class EndpointRecorder {
  private readonly seen = new Map<string, DiscoveredEndpoint>();
  private attached = false;

  constructor(private readonly win: BrowserWindow) {}

  start(): void {
    if (this.attached) return;
    this.attached = true;

    this.win.webContents.session.webRequest.onCompleted((details) => {
      if (!isInterestingEndpoint(details.url)) return;
      // Electron reports both XHR and fetch as 'xhr'; 'other' catches the stragglers.
      // Document, script and media loads are not the data API.
      if (details.resourceType !== 'xhr' && details.resourceType !== 'other') return;

      try {
        const url = new URL(details.url);
        const key = `${details.method} ${url.pathname}`;
        const existing = this.seen.get(key);

        if (existing) {
          existing.count += 1;
          for (const name of url.searchParams.keys()) {
            if (!existing.paramNames.includes(name)) existing.paramNames.push(name);
          }
          return;
        }

        this.seen.set(key, {
          method: details.method,
          path: url.pathname,
          paramNames: [...url.searchParams.keys()],
          count: 1,
          status: details.statusCode,
        });
      } catch {
        // A malformed URL is not worth failing a discovery run over.
      }
    });
  }

  results(): DiscoveredEndpoint[] {
    return [...this.seen.values()].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  }

  /** A redacted, pasteable summary — paths and parameter names only. */
  report(): string {
    const rows = this.results();
    if (rows.length === 0) {
      return 'No data requests were recorded. Open the schedule and homework pages while recording.';
    }
    const lines = rows.map(
      (r) => `${r.method.padEnd(5)} ${r.path}${r.paramNames.length ? `  ?${r.paramNames.join('&')}` : ''}  (x${r.count}, ${r.status ?? '?'})`,
    );
    log.info(`[nz] discovery recorded ${rows.length} endpoints`);
    return ['Endpoints observed on nz.ua (paths and parameter names only):', '', ...lines].join('\n');
  }
}
