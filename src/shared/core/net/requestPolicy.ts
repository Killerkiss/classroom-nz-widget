/**
 * Pure request-pacing policy: given past behaviour and the current instant, decide
 * when the next request may go out and whether the circuit is open.
 *
 * Kept pure and separate from the transport so the pacing rules can be tested
 * exhaustively — and so they cannot be quietly bypassed from a call site.
 */

export interface RequestPolicyOptions {
  /** Minimum gap between two consecutive requests. */
  minIntervalMs: number;
  /** Ceiling on requests within the rolling window below. */
  maxPerWindow: number;
  windowMs: number;
  /** Consecutive failures that trip the breaker. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing a trial request. */
  breakerCooldownMs: number;
  /** Backoff base for a retryable failure; doubles per consecutive failure. */
  backoffBaseMs: number;
  backoffMaxMs: number;
}

/**
 * An undocumented, Cloudflare-protected endpoint deserves a conservative default:
 * roughly one request every five seconds and never more than 60 an hour.
 */
export const DEFAULT_REQUEST_POLICY: RequestPolicyOptions = {
  minIntervalMs: 5_000,
  maxPerWindow: 60,
  windowMs: 60 * 60_000,
  failureThreshold: 5,
  breakerCooldownMs: 30 * 60_000,
  backoffBaseMs: 2_000,
  backoffMaxMs: 5 * 60_000,
};

export interface RequestPolicyState {
  /** Timestamps of recent requests, newest last. Pruned to the window. */
  recent: number[];
  consecutiveFailures: number;
  lastFailureAt: number | null;
  /** Set when the server told us explicitly to wait (Retry-After). */
  retryAfterUntil: number | null;
}

export const initialPolicyState = (): RequestPolicyState => ({
  recent: [],
  consecutiveFailures: 0,
  lastFailureAt: null,
  retryAfterUntil: null,
});

export type PolicyDecision =
  | { allow: true }
  | { allow: false; waitMs: number; reason: 'min_interval' | 'window_quota' | 'backoff' | 'retry_after' }
  | { allow: false; waitMs: number; reason: 'circuit_open' };

/** Whether the breaker is currently open (too many consecutive failures, recently). */
export function isCircuitOpen(
  state: RequestPolicyState,
  now: number,
  opts: RequestPolicyOptions,
): boolean {
  if (state.consecutiveFailures < opts.failureThreshold) return false;
  if (state.lastFailureAt === null) return false;
  return now - state.lastFailureAt < opts.breakerCooldownMs;
}

export function decide(
  state: RequestPolicyState,
  now: number,
  opts: RequestPolicyOptions = DEFAULT_REQUEST_POLICY,
): PolicyDecision {
  if (isCircuitOpen(state, now, opts)) {
    const waitMs = (state.lastFailureAt as number) + opts.breakerCooldownMs - now;
    return { allow: false, waitMs, reason: 'circuit_open' };
  }

  // An explicit Retry-After outranks our own guesses.
  if (state.retryAfterUntil !== null && now < state.retryAfterUntil) {
    return { allow: false, waitMs: state.retryAfterUntil - now, reason: 'retry_after' };
  }

  if (state.consecutiveFailures > 0 && state.lastFailureAt !== null) {
    const backoff = backoffMs(state.consecutiveFailures, opts);
    const readyAt = state.lastFailureAt + backoff;
    if (now < readyAt) return { allow: false, waitMs: readyAt - now, reason: 'backoff' };
  }

  const recent = prune(state.recent, now, opts.windowMs);

  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < opts.minIntervalMs) {
    return { allow: false, waitMs: opts.minIntervalMs - (now - last), reason: 'min_interval' };
  }

  if (recent.length >= opts.maxPerWindow) {
    const oldest = recent[0] as number;
    return { allow: false, waitMs: oldest + opts.windowMs - now, reason: 'window_quota' };
  }

  return { allow: true };
}

/** Exponential with a ceiling. Deterministic — jitter is applied by the caller. */
export function backoffMs(consecutiveFailures: number, opts: RequestPolicyOptions): number {
  const raw = opts.backoffBaseMs * 2 ** (consecutiveFailures - 1);
  return Math.min(raw, opts.backoffMaxMs);
}

export function recordRequest(
  state: RequestPolicyState,
  now: number,
  opts: RequestPolicyOptions = DEFAULT_REQUEST_POLICY,
): RequestPolicyState {
  return { ...state, recent: [...prune(state.recent, now, opts.windowMs), now] };
}

export function recordSuccess(state: RequestPolicyState): RequestPolicyState {
  return { ...state, consecutiveFailures: 0, lastFailureAt: null, retryAfterUntil: null };
}

export function recordFailure(
  state: RequestPolicyState,
  now: number,
  retryAfterMs?: number,
): RequestPolicyState {
  return {
    ...state,
    consecutiveFailures: state.consecutiveFailures + 1,
    lastFailureAt: now,
    retryAfterUntil: retryAfterMs !== undefined ? now + retryAfterMs : state.retryAfterUntil,
  };
}

function prune(recent: readonly number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return recent.filter((t) => t > cutoff);
}
