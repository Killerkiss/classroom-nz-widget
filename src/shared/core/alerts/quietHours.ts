import type { AlertSettings } from '../../domain/settings';
import { civilTimeIn, isTimeWithin } from '../timezone';

/**
 * Whether an instant falls inside the configured quiet window.
 *
 * Evaluated against the *slot*, not the moment the engine runs: a slot inside quiet
 * hours is skipped outright rather than deferred, so a laptop opened at 02:00 never
 * produces a notification that was due at 23:00.
 */
export function isQuiet(instant: Date, settings: AlertSettings, tz: string): boolean {
  const q = settings.quietHours;
  if (!q) return false;
  return isTimeWithin(civilTimeIn(instant, tz), q.start, q.end);
}
