import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { CivilDate, CivilTime, Instant } from '../domain/models';

/**
 * Everything here answers calendar questions in the *school's* timezone, never the
 * machine's. The family may travel; the school day does not move. Nothing in this
 * module may use getHours()/getDate(), which read the OS timezone.
 */

/** The civil date in `tz` at the given instant. */
export function civilDateIn(instant: Date, tz: string): CivilDate {
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/** The wall-clock time in `tz` at the given instant. */
export function civilTimeIn(instant: Date, tz: string): CivilTime {
  return formatInTimeZone(instant, tz, 'HH:mm');
}

/** The hour (0–23) in `tz` at the given instant. */
export function hourIn(instant: Date, tz: string): number {
  return Number(formatInTimeZone(instant, tz, 'H'));
}

/** ISO weekday in `tz`: 1 = Monday … 7 = Sunday. */
export function isoWeekdayIn(instant: Date, tz: string): number {
  return Number(formatInTimeZone(instant, tz, 'i'));
}

/**
 * The instant at which a given wall-clock time occurs in `tz`.
 *
 * DST caveat, made explicit because it is otherwise accidental: on the spring-forward
 * night 02:00–03:00 does not exist in Europe/Kyiv, and date-fns-tz resolves such a
 * time forward. On the autumn night 03:00–04:00 occurs twice and the earlier is
 * chosen. Both are covered by tests rather than left to chance.
 */
export function instantAt(date: CivilDate, time: CivilTime, tz: string): Date {
  return fromZonedTime(`${date}T${time}:00`, tz);
}

/** The instant at the start of the given hour on the given civil date in `tz`. */
export function instantAtHour(date: CivilDate, hour: number, tz: string): Date {
  const hh = String(hour).padStart(2, '0');
  return instantAt(date, `${hh}:00`, tz);
}

/** Add whole calendar days to a civil date. Safe across DST and month boundaries. */
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  // Noon UTC anchor: far enough from either boundary that a +/-1h DST shift can
  // never roll the date, which is exactly the bug this avoids.
  const anchor = new Date(`${date}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/** ISO weekday of a civil date: 1 = Monday … 7 = Sunday. */
export function isoWeekdayOf(date: CivilDate): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toInstant(d: Date): Instant {
  return d.toISOString();
}

/**
 * Whether `time` falls inside a [start, end) window, handling windows that wrap
 * midnight (22:00–07:00 is the default quiet-hours window and does wrap).
 */
export function isTimeWithin(time: CivilTime, start: CivilTime, end: CivilTime): boolean {
  if (start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

/** Format an instant for display in the school timezone. */
export function formatIn(instant: Date, tz: string, pattern: string): string {
  return formatInTimeZone(instant, tz, pattern);
}
