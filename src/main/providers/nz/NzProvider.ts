import type { ProfileId } from '@shared/domain/ids';
import type { Announcement, Assignment, Course, Lesson } from '@shared/domain/models';
import type { AuthStatus, Capability, ProviderHealth } from '@shared/ipc/contract';
import { ProviderError } from '@shared/domain/errors';
import {
  DEFAULT_REQUEST_POLICY,
  decide,
  initialPolicyState,
  recordFailure,
  recordRequest,
  recordSuccess,
} from '@shared/core/net/requestPolicy';
import type { RequestPolicyState } from '@shared/core/net/requestPolicy';
import { log } from '@main/logging';
import type { DateRange, FetchContext, SchoolDataProvider } from '../SchoolDataProvider';
import type { NzEndpointConfig } from './endpoints';
import { EMPTY_ENDPOINTS, isConfigured } from './endpoints';
import type { NzRawResponse, NzRequest, NzTransport } from './transport/NzTransport';

const SOURCE = 'nz' as const;

/**
 * nz.ua provider.
 *
 * The transport, pacing and health plumbing are complete and tested. What is not
 * yet known is the endpoint map: nz.ua publishes no API, and every request from
 * outside a logged-in browser returns Cloudflare's challenge, so the paths have to
 * be observed on the user's own machine (see docs/NZ_INTEGRATION.md).
 *
 * Until they are, `capabilities()` is empty. That is deliberate — the UI then says
 * "no timetable source" instead of rendering an empty timetable, which would look
 * exactly like "no lessons today".
 */
export class NzProvider implements SchoolDataProvider {
  readonly source = SOURCE;
  private policy: RequestPolicyState = initialPolicyState();
  private currentHealth: ProviderHealth;

  constructor(
    readonly profileId: ProfileId,
    readonly displayName: string,
    private readonly transport: NzTransport,
    private readonly endpoints: NzEndpointConfig = EMPTY_ENDPOINTS,
  ) {
    this.currentHealth = {
      source: SOURCE,
      profileId,
      status: isConfigured(endpoints) ? 'ok' : 'degraded',
      capabilities: {},
      transport: transport.kind,
    };
  }

  capabilities(): ReadonlySet<Capability> {
    const caps = new Set<Capability>();
    if (this.endpoints.schedule) {
      caps.add('timetable');
      caps.add('meetLinks');
    }
    if (this.endpoints.homework) caps.add('homework');
    if (this.endpoints.grades) caps.add('grades');
    return caps;
  }

  health(): ProviderHealth {
    return this.currentHealth;
  }

  async authStatus(): Promise<AuthStatus> {
    const state = await this.transport.ensureSession();
    if (state === 'ok') return 'authenticated';
    return state === 'login_required' ? 'expired' : 'unauthenticated';
  }

  async authenticate(): Promise<void> {
    const state = await this.transport.ensureSession();
    if (state === 'ok') return;
    throw new ProviderError({
      kind: state === 'blocked' ? 'WAF' : 'AUTH',
      source: SOURCE,
      message:
        state === 'blocked'
          ? 'nz.ua is currently serving a bot check that did not clear. Try again shortly.'
          : 'Sign in to nz.ua to continue.',
    });
  }

  async signOut(): Promise<void> {
    await this.transport.dispose();
  }

  /** Courses come from the timetable, so there is nothing separate to fetch. */
  async listCourses(_ctx: FetchContext): Promise<Course[]> {
    return [];
  }

  async listLessons(_range: DateRange, _ctx: FetchContext): Promise<Lesson[]> {
    this.requireConfigured('timetable');
    return [];
  }

  async listAssignments(_range: DateRange, _ctx: FetchContext): Promise<Assignment[]> {
    this.requireConfigured('homework');
    return [];
  }

  async listAnnouncements(_range: DateRange, _ctx: FetchContext): Promise<Announcement[]> {
    return [];
  }

  /**
   * Every nz.ua request goes through here, so the pacing rules cannot be bypassed
   * from a call site. An undocumented endpoint behind a bot filter deserves to be
   * approached politely.
   */
  private async send(req: NzRequest, now: number): Promise<NzRawResponse> {
    const verdict = decide(this.policy, now, DEFAULT_REQUEST_POLICY);
    if (!verdict.allow) {
      throw new ProviderError({
        kind: verdict.reason === 'circuit_open' ? 'WAF' : 'RATE_LIMIT',
        source: SOURCE,
        message: `Holding off on nz.ua (${verdict.reason}); retrying in ${Math.ceil(verdict.waitMs / 1000)}s.`,
      });
    }

    this.policy = recordRequest(this.policy, now, DEFAULT_REQUEST_POLICY);

    const response = await this.transport.request(req);

    if (response.challenged) {
      this.policy = recordFailure(this.policy, now, (response.retryAfterSeconds ?? 60) * 1000);
      log.warn(`[nz] bot check on ${req.path}`);
      throw new ProviderError({
        kind: 'WAF',
        source: SOURCE,
        status: response.status,
        message: 'nz.ua returned a bot check instead of data.',
      });
    }

    if (response.status === 401 || response.status === 403) {
      this.policy = recordFailure(this.policy, now);
      throw new ProviderError({ kind: 'AUTH', source: SOURCE, status: response.status, message: 'Sign in to nz.ua again.' });
    }

    if (response.status >= 400) {
      this.policy = recordFailure(this.policy, now, response.retryAfterSeconds ? response.retryAfterSeconds * 1000 : undefined);
      throw new ProviderError({
        kind: response.status === 429 ? 'RATE_LIMIT' : 'UNKNOWN',
        source: SOURCE,
        status: response.status,
        message: `nz.ua request failed (${response.status}).`,
      });
    }

    this.policy = recordSuccess(this.policy);
    return response;
  }

  private requireConfigured(capability: Capability): void {
    if (isConfigured(this.endpoints)) return;
    throw new ProviderError({
      kind: 'SCHEMA_DRIFT',
      source: SOURCE,
      message: `nz.ua ${capability} is not set up yet — run endpoint discovery (docs/NZ_INTEGRATION.md).`,
    });
  }

  /** Exposed for tests: the pacing state is otherwise private. */
  _sendForTest(req: NzRequest, now: number): Promise<NzRawResponse> {
    return this.send(req, now);
  }
}
