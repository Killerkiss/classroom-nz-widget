import type { SourceId } from './ids';

/**
 * Why a provider call failed. The taxonomy exists so the UI can say something
 * useful ("sign in again" vs "nz.ua changed") instead of a generic error, and so
 * the transport layer can decide whether to retry, back off, or switch strategy.
 */
export type ProviderErrorKind =
  /** Credentials missing, expired or rejected. The user must act. */
  | 'AUTH'
  /** Blocked by a bot filter or challenge page. Switch transport, do not retry. */
  | 'WAF'
  /** The response parsed as JSON but did not match our schema — upstream changed. */
  | 'SCHEMA_DRIFT'
  /** Offline, DNS failure, timeout. Retry with backoff. */
  | 'NETWORK'
  /** Explicitly rate limited. Back off hard. */
  | 'RATE_LIMIT'
  | 'UNKNOWN';

export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  message: string;
  source: SourceId;
  at: string;
  /** HTTP status, where there was one. */
  status?: number;
  /**
   * For SCHEMA_DRIFT: a redacted description of the shape we got (key names and
   * types only). Never contains values — responses carry class rosters and grades.
   */
  shapeSummary?: string;
  retryable: boolean;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly source: SourceId;
  readonly status?: number;
  readonly shapeSummary?: string;

  constructor(info: Omit<ProviderErrorInfo, 'at' | 'retryable'>, options?: { cause?: unknown }) {
    super(info.message, options);
    this.name = 'ProviderError';
    this.kind = info.kind;
    this.source = info.source;
    this.status = info.status;
    this.shapeSummary = info.shapeSummary;
  }

  get retryable(): boolean {
    return isRetryable(this.kind);
  }

  toInfo(at: string): ProviderErrorInfo {
    return {
      kind: this.kind,
      message: this.message,
      source: this.source,
      at,
      status: this.status,
      shapeSummary: this.shapeSummary,
      retryable: this.retryable,
    };
  }
}

export function isRetryable(kind: ProviderErrorKind): boolean {
  // AUTH needs the user. WAF needs a different transport, not another attempt.
  // SCHEMA_DRIFT will fail identically until the code is changed.
  return kind === 'NETWORK' || kind === 'RATE_LIMIT' || kind === 'UNKNOWN';
}

/** Classify an unknown thrown value. Never throws. */
export function classifyError(err: unknown, source: SourceId): ProviderError {
  if (err instanceof ProviderError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code;

  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return new ProviderError({ kind: 'NETWORK', message, source }, { cause: err });
  }
  return new ProviderError({ kind: 'UNKNOWN', message, source }, { cause: err });
}
