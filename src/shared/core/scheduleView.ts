import type { ScheduleViewSettings } from '../domain/settings';
import type { CivilDate, Instant } from '../domain/models';
import { addCivilDays, civilDateIn, hourIn, instantAtHour, isoWeekdayOf, toInstant } from './timezone';

export type ScheduleLabel = 'today' | 'tomorrow' | 'next_school_day';

export interface ScheduleSelection {
  /** The school day whose lessons should be shown. */
  date: CivilDate;
  label: ScheduleLabel;
  /**
   * The instant at which this selection stops being correct. The renderer sets one
   * timer for this rather than polling the clock — and because it is derived rather
   * than guessed, the flip happens exactly on the boundary.
   */
  validUntil: Instant;
}

/** Guard against a misconfigured schoolDays list (e.g. emptied in settings). */
const MAX_LOOKAHEAD_DAYS = 14;

/**
 * Decide which day's schedule to show.
 *
 * Before the flip hour it is today's; from the flip hour onward it is the next
 * day's, so the evening is spent preparing for the right morning. If that lands on
 * a non-school day and skipWeekendsToNextSchoolDay is on, it walks forward to the
 * next school day — which is what makes Friday evening show Monday rather than an
 * empty Saturday.
 */
export function selectScheduleDay(now: Date, settings: ScheduleViewSettings): ScheduleSelection {
  const { timezone: tz, flipHour, skipWeekendsToNextSchoolDay, schoolDays } = settings;

  const today = civilDateIn(now, tz);
  const flipped = hourIn(now, tz) >= flipHour;

  let date = flipped ? addCivilDays(today, 1) : today;
  let label: ScheduleLabel = flipped ? 'tomorrow' : 'today';

  if (skipWeekendsToNextSchoolDay && schoolDays.length > 0) {
    let skipped = 0;
    while (!schoolDays.includes(isoWeekdayOf(date)) && skipped < MAX_LOOKAHEAD_DAYS) {
      date = addCivilDays(date, 1);
      skipped += 1;
    }
    if (skipped > 0) label = 'next_school_day';
  }

  // Before the flip, the selection changes at the flip hour. After it, the change
  // comes at midnight — the date stays put, but 'tomorrow' becomes 'today'.
  const validUntil = flipped
    ? instantAtHour(addCivilDays(today, 1), 0, tz)
    : instantAtHour(today, flipHour, tz);

  return { date, label, validUntil: toInstant(validUntil) };
}
