import { describe, expect, it } from 'vitest';
import { selectScheduleDay } from '@shared/core/scheduleView';
import { DEFAULT_SETTINGS } from '@shared/domain/settings';

const settings = DEFAULT_SETTINGS.schedule;

/** Kyiv is UTC+3 in summer (EEST) and UTC+2 in winter (EET). */
const kyiv = (isoUtc: string) => new Date(isoUtc);

describe('selectScheduleDay — the 18:00 flip', () => {
  it('shows today at 17:59 Kyiv', () => {
    // 2026-09-16 is a Wednesday. 14:59Z = 17:59 EEST.
    const r = selectScheduleDay(kyiv('2026-09-16T14:59:00Z'), settings);
    expect(r).toMatchObject({ date: '2026-09-16', label: 'today' });
  });

  it('flips to tomorrow at exactly 18:00 Kyiv', () => {
    const r = selectScheduleDay(kyiv('2026-09-16T15:00:00Z'), settings);
    expect(r).toMatchObject({ date: '2026-09-17', label: 'tomorrow' });
  });

  it('still shows tomorrow at 18:01', () => {
    const r = selectScheduleDay(kyiv('2026-09-16T15:01:00Z'), settings);
    expect(r).toMatchObject({ date: '2026-09-17', label: 'tomorrow' });
  });

  it('keeps the same date across midnight but relabels it today', () => {
    const evening = selectScheduleDay(kyiv('2026-09-16T20:00:00Z'), settings); // 23:00 Kyiv
    const morning = selectScheduleDay(kyiv('2026-09-16T22:00:00Z'), settings); // 01:00 Kyiv, 17th
    expect(evening).toMatchObject({ date: '2026-09-17', label: 'tomorrow' });
    expect(morning).toMatchObject({ date: '2026-09-17', label: 'today' });
  });
});

describe('validUntil drives exactly one timer', () => {
  it('points at the flip hour when before it', () => {
    const r = selectScheduleDay(kyiv('2026-09-16T09:00:00Z'), settings); // 12:00 Kyiv
    expect(r.validUntil).toBe('2026-09-16T15:00:00.000Z'); // 18:00 Kyiv
  });

  it('points at midnight when past the flip hour', () => {
    const r = selectScheduleDay(kyiv('2026-09-16T16:00:00Z'), settings); // 19:00 Kyiv
    expect(r.validUntil).toBe('2026-09-16T21:00:00.000Z'); // 00:00 Kyiv on the 17th
  });

  it('is always in the future', () => {
    for (const hour of [0, 6, 12, 17, 18, 19, 23]) {
      const now = kyiv(`2026-09-16T${String(hour).padStart(2, '0')}:30:00Z`);
      expect(new Date(selectScheduleDay(now, settings).validUntil).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('weekend skipping', () => {
  it('shows Monday on Friday evening, not Saturday', () => {
    // 2026-09-18 is a Friday. 16:00Z = 19:00 Kyiv, past the flip.
    const r = selectScheduleDay(kyiv('2026-09-18T16:00:00Z'), settings);
    expect(r).toMatchObject({ date: '2026-09-21', label: 'next_school_day' });
    expect(new Date(`${r.date}T12:00:00Z`).getUTCDay()).toBe(1); // Monday
  });

  it('shows Monday on a Saturday morning', () => {
    const r = selectScheduleDay(kyiv('2026-09-19T07:00:00Z'), settings);
    expect(r).toMatchObject({ date: '2026-09-21', label: 'next_school_day' });
  });

  it('shows Saturday when weekend skipping is off', () => {
    const r = selectScheduleDay(kyiv('2026-09-18T16:00:00Z'), {
      ...settings,
      skipWeekendsToNextSchoolDay: false,
    });
    expect(r).toMatchObject({ date: '2026-09-19', label: 'tomorrow' });
  });

  it('terminates rather than looping when schoolDays is empty', () => {
    const r = selectScheduleDay(kyiv('2026-09-18T16:00:00Z'), { ...settings, schoolDays: [] });
    expect(r.date).toBe('2026-09-19');
  });
});

describe('the machine timezone is irrelevant', () => {
  const original = process.env.TZ;

  it.each(['America/New_York', 'Asia/Tokyo', 'UTC', 'Europe/Kyiv'])(
    'gives the same answer with machine TZ=%s',
    (tz) => {
      process.env.TZ = tz;
      const r = selectScheduleDay(kyiv('2026-09-16T15:00:00Z'), settings);
      expect(r).toMatchObject({ date: '2026-09-17', label: 'tomorrow' });
      process.env.TZ = original;
    },
  );
});

describe('DST boundaries in Europe/Kyiv', () => {
  it('handles the spring-forward night (last Sunday of March)', () => {
    // 2027-03-28: clocks go 03:00 -> 04:00. 15:00Z = 18:00 EEST (UTC+3).
    const r = selectScheduleDay(kyiv('2027-03-28T15:00:00Z'), settings);
    expect(r.label).toBe('tomorrow');
    expect(r.date).toBe('2027-03-29');
  });

  it('handles the autumn fall-back night (last Sunday of October)', () => {
    // 2026-10-25: clocks go 04:00 -> 03:00. After the shift Kyiv is UTC+2,
    // so 16:00Z = 18:00 EET and the flip must have happened.
    const r = selectScheduleDay(kyiv('2026-10-25T16:00:00Z'), settings);
    expect(r.label).toBe('tomorrow');
    expect(r.date).toBe('2026-10-26');
  });

  it('does not flip at 17:00 local on the fall-back day', () => {
    // 2026-10-25 is itself a Sunday, so weekend skipping is disabled here to keep
    // this test about the DST offset and nothing else.
    const noSkip = { ...settings, skipWeekendsToNextSchoolDay: false };
    const r = selectScheduleDay(kyiv('2026-10-25T15:00:00Z'), noSkip); // 17:00 EET
    expect(r.label).toBe('today');
    expect(r.date).toBe('2026-10-25');
  });
});

describe('a configurable flip hour', () => {
  it('respects a custom hour', () => {
    const early = { ...settings, flipHour: 15, skipWeekendsToNextSchoolDay: false };
    expect(selectScheduleDay(kyiv('2026-09-16T11:59:00Z'), early).label).toBe('today');
    expect(selectScheduleDay(kyiv('2026-09-16T12:00:00Z'), early).label).toBe('tomorrow');
  });
});
