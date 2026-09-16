import { describe, expect, it } from 'vitest';
import {
  conferenceUrlOf,
  matchConferenceSlot,
  toConferenceSlot,
} from '@shared/core/meet/conferenceSlots';
import type { ConferenceSlot } from '@shared/core/meet/conferenceSlots';

const slot = (over: Partial<ConferenceSlot> = {}): ConferenceSlot => ({
  startsAt: '2026-09-16T07:00:00.000Z',
  endsAt: '2026-09-16T07:45:00.000Z',
  title: 'Алгебра',
  url: 'https://meet.google.com/aaa',
  subjectKey: 'algebra',
  ...over,
});

const lesson = {
  startsAt: '2026-09-16T07:00:00.000Z',
  endsAt: '2026-09-16T07:45:00.000Z',
  subjectKey: 'algebra',
};

describe('toConferenceSlot', () => {
  it('reads the link from conferenceData', () => {
    const result = toConferenceSlot({
      summary: 'Алгебра',
      start: { dateTime: '2026-09-16T10:00:00+03:00' },
      end: { dateTime: '2026-09-16T10:45:00+03:00' },
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc' }] },
    });

    expect(result).toMatchObject({ url: 'https://meet.google.com/abc', subjectKey: 'algebra' });
    expect(result?.startsAt).toBe('2026-09-16T07:00:00.000Z');
  });

  it('falls back to the legacy hangoutLink', () => {
    const result = toConferenceSlot({
      summary: 'Фізика',
      start: { dateTime: '2026-09-16T10:00:00Z' },
      end: { dateTime: '2026-09-16T10:45:00Z' },
      hangoutLink: 'https://meet.google.com/legacy',
    });
    expect(result?.url).toBe('https://meet.google.com/legacy');
  });

  it('accepts a conference link left in the location field', () => {
    const result = toConferenceSlot({
      summary: 'Хімія',
      start: { dateTime: '2026-09-16T10:00:00Z' },
      end: { dateTime: '2026-09-16T10:45:00Z' },
      location: 'https://zoom.us/j/12345',
    });
    expect(result?.url).toBe('https://zoom.us/j/12345');
  });

  it('skips all-day events, which carry no lesson time', () => {
    // Otherwise a single all-day event would match every lesson in the day.
    expect(
      toConferenceSlot({
        summary: 'Канікули',
        start: { date: '2026-09-16' },
        end: { date: '2026-09-17' },
        hangoutLink: 'https://meet.google.com/x',
      }),
    ).toBeNull();
  });

  it('skips cancelled events', () => {
    expect(
      toConferenceSlot({
        status: 'cancelled',
        start: { dateTime: '2026-09-16T10:00:00Z' },
        end: { dateTime: '2026-09-16T10:45:00Z' },
        hangoutLink: 'https://meet.google.com/x',
      }),
    ).toBeNull();
  });

  it('skips events without any conference link', () => {
    expect(
      toConferenceSlot({
        summary: 'Педрада',
        start: { dateTime: '2026-09-16T10:00:00Z' },
        end: { dateTime: '2026-09-16T10:45:00Z' },
      }),
    ).toBeNull();
  });

  it('ignores a non-conference location', () => {
    expect(
      conferenceUrlOf({ location: 'Кабінет 204' }),
    ).toBeNull();
  });
});

describe('matchConferenceSlot', () => {
  it('matches an exactly aligned slot', () => {
    expect(matchConferenceSlot(lesson, [slot()])?.url).toBe('https://meet.google.com/aaa');
  });

  it('tolerates a small start difference', () => {
    const shifted = slot({
      startsAt: '2026-09-16T07:10:00.000Z',
      endsAt: '2026-09-16T07:55:00.000Z',
    });
    expect(matchConferenceSlot(lesson, [shifted])).not.toBeNull();
  });

  it('does not match a lesson in a different part of the day', () => {
    const far = slot({
      startsAt: '2026-09-16T12:00:00.000Z',
      endsAt: '2026-09-16T12:45:00.000Z',
    });
    expect(matchConferenceSlot(lesson, [far])).toBeNull();
  });

  it('prefers the matching subject when slots overlap', () => {
    const wrong = slot({ url: 'https://meet.google.com/wrong', subjectKey: 'physics' });
    const right = slot({ url: 'https://meet.google.com/right', subjectKey: 'algebra' });
    expect(matchConferenceSlot(lesson, [wrong, right])?.url).toBe('https://meet.google.com/right');
  });

  it('falls back to the closest start when no subject matches', () => {
    const far = slot({
      url: 'https://meet.google.com/far',
      subjectKey: 'physics',
      startsAt: '2026-09-16T07:15:00.000Z',
      endsAt: '2026-09-16T08:00:00.000Z',
    });
    const near = slot({ url: 'https://meet.google.com/near', subjectKey: 'biology' });
    expect(matchConferenceSlot(lesson, [far, near])?.url).toBe('https://meet.google.com/near');
  });

  it('returns null with no slots', () => {
    expect(matchConferenceSlot(lesson, [])).toBeNull();
  });

  it('ignores slots with unparseable times', () => {
    expect(matchConferenceSlot(lesson, [slot({ startsAt: 'nonsense', endsAt: 'nonsense' })])).toBeNull();
  });
});
