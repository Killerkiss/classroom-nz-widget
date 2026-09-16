import type { Instant, Lesson } from '../../domain/models';
import { normalizeSubject } from '../merge/subjectKey';
import { isSafeMeetUrl, looksLikeConferenceLink } from './resolveMeetLink';

/** A conferencing link with the time window it belongs to. */
export interface ConferenceSlot {
  startsAt: Instant;
  endsAt: Instant;
  title: string;
  url: string;
  /** Normalized from the event title, used to break ties between overlapping slots. */
  subjectKey: string;
}

/**
 * How far apart a lesson and a calendar event may start and still be considered
 * the same thing. School timetables and teachers' calendar entries routinely
 * disagree by a few minutes.
 */
const START_TOLERANCE_MS = 20 * 60_000;

/**
 * Find the conferencing link for a lesson.
 *
 * Matching is by time first, because a Meet link is a property of the occurrence
 * rather than the subject. Subject is used only to disambiguate when several events
 * overlap the same slot — which happens when a student is in more than one calendar.
 */
export function matchConferenceSlot(
  lesson: Pick<Lesson, 'startsAt' | 'endsAt' | 'subjectKey'>,
  slots: readonly ConferenceSlot[],
): ConferenceSlot | null {
  const lessonStart = new Date(lesson.startsAt).getTime();
  const lessonEnd = new Date(lesson.endsAt).getTime();

  const overlapping = slots.filter((slot) => {
    const start = new Date(slot.startsAt).getTime();
    const end = new Date(slot.endsAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    const overlaps = start < lessonEnd && end > lessonStart;
    return overlaps || Math.abs(start - lessonStart) <= START_TOLERANCE_MS;
  });

  if (overlapping.length === 0) return null;
  if (overlapping.length === 1) return overlapping[0] as ConferenceSlot;

  const sameSubject = overlapping.filter((s) => s.subjectKey === lesson.subjectKey);
  const pool = sameSubject.length > 0 ? sameSubject : overlapping;

  // Closest start wins, which is the most defensible tie-break available.
  return pool.reduce((best, slot) =>
    Math.abs(new Date(slot.startsAt).getTime() - lessonStart) <
    Math.abs(new Date(best.startsAt).getTime() - lessonStart)
      ? slot
      : best,
  );
}

export interface ConferenceEventLike {
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Turn a calendar event into a conference slot, or nothing.
 *
 * All-day events are skipped: they carry no usable lesson time, and treating one as
 * a slot would match it against every lesson in the day.
 */
export function toConferenceSlot(
  event: ConferenceEventLike,
  aliases: Record<string, string> = {},
): ConferenceSlot | null {
  if (event.status === 'cancelled') return null;

  const startsAt = event.start?.dateTime;
  const endsAt = event.end?.dateTime;
  if (!startsAt || !endsAt) return null;

  const url = conferenceUrlOf(event);
  if (!url) return null;

  const title = event.summary ?? '';
  return {
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    title,
    url,
    subjectKey: title ? normalizeSubject(title, aliases) : 'unknown',
  };
}

/** conferenceData is the modern field; hangoutLink survives on older events. */
export function conferenceUrlOf(event: ConferenceEventLike): string | null {
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  for (const candidate of [video, event.hangoutLink, event.location]) {
    if (isSafeMeetUrl(candidate) && looksLikeConferenceLink(candidate)) return candidate;
  }
  return null;
}
