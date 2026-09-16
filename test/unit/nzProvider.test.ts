import { describe, expect, it, vi } from 'vitest';
import { NzProvider } from '@main/providers/nz/NzProvider';
import { EMPTY_ENDPOINTS } from '@main/providers/nz/endpoints';
import type { NzRawResponse, NzSessionState, NzTransport } from '@main/providers/nz/transport/NzTransport';
import { asProfileId } from '@shared/domain/ids';
import { DEFAULT_REQUEST_POLICY } from '@shared/core/net/requestPolicy';

vi.mock('@main/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const T0 = 1_000_000;
const ctx = { signal: new AbortController().signal, now: new Date(T0) };
const range = { from: '2026-09-01', to: '2026-09-30' };

function transport(over: Partial<NzTransport> & { response?: NzRawResponse } = {}): NzTransport {
  return {
    kind: 'fixture',
    ensureSession: async (): Promise<NzSessionState> => 'ok',
    request: async () =>
      over.response ?? { status: 200, body: '{}', contentType: 'application/json', challenged: false },
    dispose: async () => {},
    ...over,
  } as NzTransport;
}

const make = (t: NzTransport, endpoints = EMPTY_ENDPOINTS) =>
  new NzProvider(asProfileId('p1'), 'nz.ua', t, endpoints);

describe('capabilities reflect what has actually been discovered', () => {
  it('claims nothing while unconfigured', () => {
    // Claiming 'timetable' here would make an empty list look like "no lessons".
    expect([...make(transport()).capabilities()]).toEqual([]);
  });

  it('claims timetable and meet links once a schedule endpoint is known', () => {
    const provider = make(transport(), { ...EMPTY_ENDPOINTS, schedule: '/api/schedule' });
    expect([...provider.capabilities()].sort()).toEqual(['meetLinks', 'timetable']);
  });

  it('claims homework once that endpoint is known', () => {
    const provider = make(transport(), { ...EMPTY_ENDPOINTS, homework: '/api/hw' });
    expect([...provider.capabilities()]).toEqual(['homework']);
  });

  it('reports itself degraded until configured', () => {
    expect(make(transport()).health().status).toBe('degraded');
  });
});

describe('unconfigured endpoints fail loudly rather than returning empty data', () => {
  it('refuses to invent a timetable', async () => {
    await expect(make(transport()).listLessons(range, ctx)).rejects.toThrow(/not set up yet/);
  });

  it('refuses to invent homework', async () => {
    await expect(make(transport()).listAssignments(range, ctx)).rejects.toThrow(/not set up yet/);
  });
});

describe('auth reflects the browser session', () => {
  it('is authenticated when the session is live', async () => {
    expect(await make(transport()).authStatus()).toBe('authenticated');
  });

  it('is expired when a login is required', async () => {
    const t = transport({ ensureSession: async () => 'login_required' as NzSessionState });
    expect(await make(t).authStatus()).toBe('expired');
  });

  it('is unauthenticated when blocked by the bot check', async () => {
    const t = transport({ ensureSession: async () => 'blocked' as NzSessionState });
    expect(await make(t).authStatus()).toBe('unauthenticated');
  });

  it('explains a bot check rather than reporting a login problem', async () => {
    const t = transport({ ensureSession: async () => 'blocked' as NzSessionState });
    await expect(make(t).authenticate()).rejects.toThrow(/bot check/);
  });
});

describe('request pacing cannot be bypassed', () => {
  it('allows the first request', async () => {
    const provider = make(transport());
    await expect(provider._sendForTest({ path: '/api/x' }, T0)).resolves.toMatchObject({ status: 200 });
  });

  it('refuses a second request inside the minimum interval', async () => {
    const provider = make(transport());
    await provider._sendForTest({ path: '/api/x' }, T0);
    await expect(provider._sendForTest({ path: '/api/x' }, T0 + 100)).rejects.toThrow(/min_interval/);
  });

  it('allows again once the interval has passed', async () => {
    const provider = make(transport());
    await provider._sendForTest({ path: '/api/x' }, T0);
    await expect(
      provider._sendForTest({ path: '/api/x' }, T0 + DEFAULT_REQUEST_POLICY.minIntervalMs),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('classifies a bot check as WAF, not a generic failure', async () => {
    const provider = make(
      transport({
        response: { status: 403, body: 'Just a moment...', contentType: 'text/html', challenged: true },
      }),
    );
    await expect(provider._sendForTest({ path: '/api/x' }, T0)).rejects.toMatchObject({ kind: 'WAF' });
  });

  it('classifies a 401 as an auth problem', async () => {
    const provider = make(
      transport({ response: { status: 401, body: '{}', contentType: 'application/json', challenged: false } }),
    );
    await expect(provider._sendForTest({ path: '/api/x' }, T0)).rejects.toMatchObject({ kind: 'AUTH' });
  });

  it('classifies a 429 as rate limiting', async () => {
    const provider = make(
      transport({
        response: { status: 429, body: '', contentType: 'application/json', challenged: false, retryAfterSeconds: 30 },
      }),
    );
    await expect(provider._sendForTest({ path: '/api/x' }, T0)).rejects.toMatchObject({ kind: 'RATE_LIMIT' });
  });

  it('opens the circuit after repeated bot checks', async () => {
    const provider = make(
      transport({
        response: { status: 403, body: 'Just a moment...', contentType: 'text/html', challenged: true },
      }),
    );

    // Space attempts out so the interval rule never masks the breaker.
    let now = T0;
    for (let i = 0; i < DEFAULT_REQUEST_POLICY.failureThreshold; i += 1) {
      now += DEFAULT_REQUEST_POLICY.backoffMaxMs;
      await provider._sendForTest({ path: '/api/x' }, now).catch(() => undefined);
    }

    await expect(provider._sendForTest({ path: '/api/x' }, now + 1_000)).rejects.toThrow(/circuit_open/);
  });
});
