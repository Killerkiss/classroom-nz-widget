import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NzRawResponse, NzRequest, NzSessionState, NzTransport } from './NzTransport';

/**
 * Replays recorded responses. Used by tests and offline development.
 *
 * CI runs against this and never touches nz.ua — besides being rude, GitHub
 * runners are datacenter IPs, which is exactly what Cloudflare challenges, so a
 * live call would fail the build for reasons unrelated to the change.
 */
export class FixtureTransport implements NzTransport {
  readonly kind = 'fixture' as const;

  constructor(
    private readonly dir: string = join(import.meta.dirname, '../fixtures'),
    private readonly inline: Record<string, NzRawResponse> = {},
  ) {}

  async ensureSession(): Promise<NzSessionState> {
    return 'ok';
  }

  async request(req: NzRequest): Promise<NzRawResponse> {
    const key = `${req.method ?? 'GET'} ${req.path}`;
    const fromInline = this.inline[key] ?? this.inline[req.path];
    if (fromInline) return fromInline;

    const file = join(this.dir, `${slug(key)}.json`);
    if (!existsSync(file)) {
      return { status: 404, body: `No fixture for ${key}`, contentType: 'text/plain', challenged: false };
    }

    return {
      status: 200,
      body: readFileSync(file, 'utf8'),
      contentType: 'application/json',
      challenged: false,
    };
  }

  async dispose(): Promise<void> {}
}

function slug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
