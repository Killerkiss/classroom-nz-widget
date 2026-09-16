import type { Course, Lesson } from '../../domain/models';

export type MeetLinkSource = 'calendar' | 'nz' | 'override' | 'course';

export interface ResolvedMeetLink {
  url: string;
  source: MeetLinkSource;
}

export interface MeetLinkInputs {
  /** From a Google Calendar event's conferenceData, matched to this lesson. */
  calendarLink?: string;
  /** A link the teacher put in the nz.ua lesson entry. */
  nzLink?: string;
  /** Per-subject manual override from Settings, keyed by subjectKey. */
  overrides: Record<string, string>;
  /** A course-level Meet room, where the source exposes one. */
  course?: Pick<Course, 'meetLink'>;
}

/**
 * Only https links are ever surfaced. A widget button that hands an arbitrary
 * provider-supplied string to the OS opener is a real hazard on Linux, where
 * file:// and custom schemes can launch local programs.
 */
export function isSafeMeetUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    return new URL(url.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Recognized conferencing hosts, so an unrelated https link is not offered as "Meet". */
const CONFERENCE_HOSTS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'whereby.com',
  'meet.jit.si',
  'bbb.', // BigBlueButton, widely used by Ukrainian schools
];

export function looksLikeConferenceLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return CONFERENCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
  } catch {
    return false;
  }
}

/** Pull the first conference link out of free text, e.g. an nz.ua lesson note. */
export function extractConferenceLink(text: string | undefined): string | null {
  if (!text) return null;
  for (const match of text.matchAll(/https:\/\/[^\s<>"')]+/g)) {
    const url = match[0].replace(/[.,;:)]+$/, '');
    if (isSafeMeetUrl(url) && looksLikeConferenceLink(url)) return url;
  }
  return null;
}

/**
 * Pick the link for a lesson.
 *
 * Order is deliberate: a manual override is the user's explicit instruction and
 * always wins. Calendar comes next because a per-lesson event link is specific to
 * that occurrence. nz.ua follows, and a course-level room is the last resort
 * because it is the least specific.
 */
export function resolveMeetLink(
  lesson: Pick<Lesson, 'subjectKey'>,
  inputs: MeetLinkInputs,
): ResolvedMeetLink | null {
  const override = inputs.overrides[lesson.subjectKey];
  if (isSafeMeetUrl(override)) return { url: override, source: 'override' };

  if (isSafeMeetUrl(inputs.calendarLink) && looksLikeConferenceLink(inputs.calendarLink)) {
    return { url: inputs.calendarLink, source: 'calendar' };
  }

  const nz = isSafeMeetUrl(inputs.nzLink) ? inputs.nzLink : extractConferenceLink(inputs.nzLink);
  if (nz && looksLikeConferenceLink(nz)) return { url: nz, source: 'nz' };

  const courseLink = inputs.course?.meetLink;
  if (isSafeMeetUrl(courseLink) && looksLikeConferenceLink(courseLink)) {
    return { url: courseLink, source: 'course' };
  }

  return null;
}
