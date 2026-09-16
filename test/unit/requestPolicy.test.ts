import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_POLICY,
  backoffMs,
  decide,
  initialPolicyState,
  isCircuitOpen,
  recordFailure,
  recordRequest,
  recordSuccess,
} from '@shared/core/net/requestPolicy';
import type { RequestPolicyState } from '@shared/core/net/requestPolicy';

const opts = DEFAULT_REQUEST_POLICY;
const T0 = 1_000_000;

describe('minimum interval', () => {
  it('allows the very first request', () => {
    expect(decide(initialPolicyState(), T0, opts)).toEqual({ allow: true });
  });

  it('blocks a second request inside the interval', () => {
    const state = recordRequest(initialPolicyState(), T0, opts);
    const result = decide(state, T0 + 1_000, opts);
    expect(result).toMatchObject({ allow: false, reason: 'min_interval', waitMs: 4_000 });
  });

  it('allows once the interval has elapsed', () => {
    const state = recordRequest(initialPolicyState(), T0, opts);
    expect(decide(state, T0 + opts.minIntervalMs, opts)).toEqual({ allow: true });
  });
});

describe('rolling window quota', () => {
  it('blocks once the hourly ceiling is reached', () => {
    let state = initialPolicyState();
    // Space them past the minimum interval so only the quota can bite.
    for (let i = 0; i < opts.maxPerWindow; i += 1) {
      state = recordRequest(state, T0 + i * opts.minIntervalMs, opts);
    }
    const now = T0 + opts.maxPerWindow * opts.minIntervalMs + opts.minIntervalMs;
    expect(decide(state, now, opts)).toMatchObject({ allow: false, reason: 'window_quota' });
  });

  it('allows again once old requests fall out of the window', () => {
    let state = initialPolicyState();
    for (let i = 0; i < opts.maxPerWindow; i += 1) {
      state = recordRequest(state, T0 + i * opts.minIntervalMs, opts);
    }
    expect(decide(state, T0 + opts.windowMs + opts.minIntervalMs + 1, opts)).toEqual({ allow: true });
  });

  it('prunes timestamps that have aged out', () => {
    let state = recordRequest(initialPolicyState(), T0, opts);
    state = recordRequest(state, T0 + opts.windowMs + 1, opts);
    expect(state.recent).toHaveLength(1);
  });
});

describe('backoff after failure', () => {
  it('doubles with each consecutive failure', () => {
    expect(backoffMs(1, opts)).toBe(2_000);
    expect(backoffMs(2, opts)).toBe(4_000);
    expect(backoffMs(3, opts)).toBe(8_000);
  });

  it('is capped', () => {
    expect(backoffMs(30, opts)).toBe(opts.backoffMaxMs);
  });

  it('blocks until the backoff has elapsed', () => {
    const state = recordFailure(initialPolicyState(), T0);
    expect(decide(state, T0 + 500, opts)).toMatchObject({ allow: false, reason: 'backoff' });
    expect(decide(state, T0 + 2_000, opts)).toEqual({ allow: true });
  });

  it('clears the backoff on success', () => {
    let state = recordFailure(initialPolicyState(), T0);
    state = recordSuccess(state);
    expect(state.consecutiveFailures).toBe(0);
    expect(decide(state, T0 + 1, opts)).toEqual({ allow: true });
  });
});

describe('circuit breaker', () => {
  function tripped(): RequestPolicyState {
    let state = initialPolicyState();
    for (let i = 0; i < opts.failureThreshold; i += 1) state = recordFailure(state, T0 + i);
    return state;
  }

  it('opens after the threshold of consecutive failures', () => {
    expect(isCircuitOpen(tripped(), T0 + 1_000, opts)).toBe(true);
  });

  it('stays closed below the threshold', () => {
    let state = initialPolicyState();
    for (let i = 0; i < opts.failureThreshold - 1; i += 1) state = recordFailure(state, T0 + i);
    expect(isCircuitOpen(state, T0 + 1_000, opts)).toBe(false);
  });

  it('reports circuit_open rather than a lesser reason', () => {
    const result = decide(tripped(), T0 + 1_000, opts);
    expect(result).toMatchObject({ allow: false, reason: 'circuit_open' });
  });

  it('closes after the cooldown', () => {
    const state = tripped();
    // The cooldown runs from the most recent failure, not from the first.
    const reopensAt = (state.lastFailureAt as number) + opts.breakerCooldownMs;
    expect(isCircuitOpen(state, reopensAt - 1, opts)).toBe(true);
    expect(isCircuitOpen(state, reopensAt, opts)).toBe(false);
  });

  it('a single success resets it', () => {
    expect(isCircuitOpen(recordSuccess(tripped()), T0 + 1_000, opts)).toBe(false);
  });
});

describe('Retry-After', () => {
  it('honours an explicit server instruction', () => {
    const state = recordFailure(initialPolicyState(), T0, 120_000);
    const result = decide(state, T0 + 10_000, opts);
    expect(result).toMatchObject({ allow: false, reason: 'retry_after' });
    expect((result as { waitMs: number }).waitMs).toBe(110_000);
  });

  it('outranks our own backoff guess', () => {
    // Backoff would be 2s; the server said two minutes, so the server wins.
    const state = recordFailure(initialPolicyState(), T0, 120_000);
    expect(decide(state, T0 + 5_000, opts)).toMatchObject({ reason: 'retry_after' });
  });

  it('is cleared by a success', () => {
    const state = recordSuccess(recordFailure(initialPolicyState(), T0, 120_000));
    expect(state.retryAfterUntil).toBeNull();
    expect(decide(state, T0 + 1, opts)).toEqual({ allow: true });
  });
});

describe('the defaults are actually conservative', () => {
  it('permits no more than about one request every five seconds', () => {
    expect(opts.minIntervalMs).toBeGreaterThanOrEqual(5_000);
  });

  it('caps the hourly volume', () => {
    expect(opts.maxPerWindow).toBeLessThanOrEqual(60);
    expect(opts.windowMs).toBe(60 * 60_000);
  });
});
