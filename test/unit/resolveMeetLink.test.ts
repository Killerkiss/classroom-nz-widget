import { describe, expect, it } from 'vitest';
import {
  extractConferenceLink,
  isSafeMeetUrl,
  looksLikeConferenceLink,
  resolveMeetLink,
} from '@shared/core/meet/resolveMeetLink';

const lesson = { subjectKey: 'algebra' };
const none = { overrides: {} };

describe('isSafeMeetUrl', () => {
  it('accepts https only', () => {
    expect(isSafeMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isSafeMeetUrl('http://meet.google.com/abc')).toBe(false);
  });

  it('rejects schemes that could launch something local', () => {
    // The whole point of the check: this reaches shell.openExternal.
    expect(isSafeMeetUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeMeetUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMeetUrl('vscode://file/etc')).toBe(false);
    expect(isSafeMeetUrl('data:text/html,<script>')).toBe(false);
  });

  it('rejects empty and malformed input', () => {
    expect(isSafeMeetUrl(undefined)).toBe(false);
    expect(isSafeMeetUrl('')).toBe(false);
    expect(isSafeMeetUrl('not a url')).toBe(false);
  });
});

describe('looksLikeConferenceLink', () => {
  it('recognizes the common platforms', () => {
    for (const url of [
      'https://meet.google.com/abc-defg-hij',
      'https://us02web.zoom.us/j/123',
      'https://teams.microsoft.com/l/meetup-join/x',
      'https://meet.jit.si/room',
      'https://bbb.school.edu.ua/b/abc',
    ]) {
      expect(looksLikeConferenceLink(url)).toBe(true);
    }
  });

  it('rejects an ordinary link, so it is not offered as a Meet button', () => {
    expect(looksLikeConferenceLink('https://wikipedia.org/wiki/Algebra')).toBe(false);
    expect(looksLikeConferenceLink('https://classroom.google.com/c/1')).toBe(false);
  });
});

describe('extractConferenceLink', () => {
  it('finds a link inside a lesson note', () => {
    expect(
      extractConferenceLink('Урок онлайн: https://meet.google.com/abc-defg-hij Заходьте вчасно'),
    ).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('strips trailing punctuation', () => {
    expect(extractConferenceLink('Посилання https://meet.google.com/abc-defg-hij.')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
  });

  it('ignores non-conference links in the same text', () => {
    expect(
      extractConferenceLink('Матеріали https://wikipedia.org/x і зустріч https://zoom.us/j/9'),
    ).toBe('https://zoom.us/j/9');
  });

  it('returns null when there is nothing', () => {
    expect(extractConferenceLink('Прочитати параграф 12')).toBeNull();
    expect(extractConferenceLink(undefined)).toBeNull();
  });
});

describe('resolveMeetLink — the chain', () => {
  it('prefers a manual override above everything', () => {
    const result = resolveMeetLink(lesson, {
      overrides: { algebra: 'https://meet.google.com/override' },
      calendarLink: 'https://meet.google.com/calendar',
      nzLink: 'https://meet.google.com/nz',
    });
    expect(result).toEqual({ url: 'https://meet.google.com/override', source: 'override' });
  });

  it('falls back to the calendar event link', () => {
    const result = resolveMeetLink(lesson, {
      ...none,
      calendarLink: 'https://meet.google.com/calendar',
      nzLink: 'https://meet.google.com/nz',
    });
    expect(result).toEqual({ url: 'https://meet.google.com/calendar', source: 'calendar' });
  });

  it('falls back to the nz.ua lesson link', () => {
    const result = resolveMeetLink(lesson, { ...none, nzLink: 'https://zoom.us/j/555' });
    expect(result).toEqual({ url: 'https://zoom.us/j/555', source: 'nz' });
  });

  it('extracts a link from an nz.ua note that is not bare', () => {
    const result = resolveMeetLink(lesson, {
      ...none,
      nzLink: 'Онлайн: https://meet.google.com/xyz-abcd-efg',
    });
    expect(result).toEqual({ url: 'https://meet.google.com/xyz-abcd-efg', source: 'nz' });
  });

  it('uses the course room last', () => {
    const result = resolveMeetLink(lesson, {
      ...none,
      course: { meetLink: 'https://meet.google.com/course-room' },
    });
    expect(result?.source).toBe('course');
  });

  it('returns null when nothing is available', () => {
    expect(resolveMeetLink(lesson, none)).toBeNull();
  });

  it('skips an override for a different subject', () => {
    const result = resolveMeetLink(lesson, { overrides: { physics: 'https://meet.google.com/physics' } });
    expect(result).toBeNull();
  });

  it('ignores an unsafe override rather than surfacing it', () => {
    const result = resolveMeetLink(lesson, {
      overrides: { algebra: 'file:///etc/passwd' },
      nzLink: 'https://zoom.us/j/1',
    });
    expect(result).toEqual({ url: 'https://zoom.us/j/1', source: 'nz' });
  });

  it('ignores a calendar link that is not a conference link', () => {
    const result = resolveMeetLink(lesson, {
      ...none,
      calendarLink: 'https://calendar.google.com/event?eid=1',
      nzLink: 'https://meet.jit.si/room',
    });
    expect(result?.source).toBe('nz');
  });
});
