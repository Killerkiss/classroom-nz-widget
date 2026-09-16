import { describe, expect, it } from 'vitest';
import { mapAttachments, mapDueAt, mapSubmissionState } from '@main/providers/google/mappers';
import type { GCourseWork, GStudentSubmission } from '@main/providers/google/types';

const work = (over: Partial<GCourseWork> = {}): GCourseWork => ({
  id: 'w1',
  courseId: 'c1',
  title: 'Вправи',
  ...over,
});

describe('mapDueAt', () => {
  it('returns no due date when Classroom gives none', () => {
    expect(mapDueAt(work())).toEqual({ dueIsAllDay: false });
  });

  it('treats a date without a time as due at end of day, not midnight', () => {
    // Midnight would make the work overdue the instant it was set.
    const r = mapDueAt(work({ dueDate: { year: 2026, month: 9, day: 17 } }));
    expect(r.dueIsAllDay).toBe(true);
    expect(r.dueAt).toBe('2026-09-17T23:59:59.000Z');
  });

  it('combines date and time as UTC', () => {
    const r = mapDueAt(work({ dueDate: { year: 2026, month: 9, day: 17 }, dueTime: { hours: 14, minutes: 30 } }));
    expect(r).toEqual({ dueAt: '2026-09-17T14:30:00.000Z', dueIsAllDay: false });
  });

  it('treats an empty dueTime object as all-day', () => {
    const r = mapDueAt(work({ dueDate: { year: 2026, month: 9, day: 17 }, dueTime: {} }));
    expect(r.dueIsAllDay).toBe(true);
  });

  it('handles midnight explicitly given as a time', () => {
    const r = mapDueAt(work({ dueDate: { year: 2026, month: 9, day: 17 }, dueTime: { hours: 0, minutes: 0 } }));
    expect(r).toEqual({ dueAt: '2026-09-17T00:00:00.000Z', dueIsAllDay: false });
  });
});

describe('mapSubmissionState', () => {
  const due = '2026-09-17T23:59:59.000Z';
  const before = new Date('2026-09-16T10:00:00Z');
  const after = new Date('2026-09-19T10:00:00Z');

  const sub = (over: Partial<GStudentSubmission> = {}): GStudentSubmission => ({
    id: 's1',
    courseId: 'c1',
    courseWorkId: 'w1',
    ...over,
  });

  it('maps TURNED_IN to submitted', () => {
    expect(mapSubmissionState(sub({ state: 'TURNED_IN' }), due, before).state).toBe('submitted');
  });

  it('maps RETURNED without a grade to returned, which re-arms alerts', () => {
    expect(mapSubmissionState(sub({ state: 'RETURNED' }), due, before).state).toBe('returned');
  });

  it('maps RETURNED with a grade to graded', () => {
    const r = mapSubmissionState(sub({ state: 'RETURNED', assignedGrade: 11 }), due, before);
    expect(r.state).toBe('graded');
    expect(r.grade).toEqual({ value: 11, scale: 'points' });
  });

  it('maps NEW before the due date to not_started', () => {
    expect(mapSubmissionState(sub({ state: 'NEW' }), due, before).state).toBe('not_started');
  });

  it('maps CREATED before the due date to in_progress', () => {
    expect(mapSubmissionState(sub({ state: 'CREATED' }), due, before).state).toBe('in_progress');
  });

  it('marks unsubmitted work past its due date as missing', () => {
    expect(mapSubmissionState(sub({ state: 'NEW' }), due, after).state).toBe('missing');
    expect(mapSubmissionState(sub({ state: 'CREATED' }), due, after).state).toBe('missing');
  });

  it('never marks submitted work missing, however late', () => {
    expect(mapSubmissionState(sub({ state: 'TURNED_IN' }), due, after).state).toBe('submitted');
  });

  it('handles a missing submission record', () => {
    expect(mapSubmissionState(undefined, due, before).state).toBe('not_started');
    expect(mapSubmissionState(undefined, due, after).state).toBe('missing');
  });

  it('carries the late flag through', () => {
    expect(mapSubmissionState(sub({ state: 'TURNED_IN', late: true }), due, before).late).toBe(true);
  });

  it('does not invent a due date when there is none', () => {
    expect(mapSubmissionState(sub({ state: 'NEW' }), undefined, after).state).toBe('not_started');
  });
});

describe('mapAttachments', () => {
  it('returns nothing for absent materials', () => {
    expect(mapAttachments(undefined)).toEqual([]);
    expect(mapAttachments([])).toEqual([]);
  });

  it('maps each material kind', () => {
    const result = mapAttachments([
      { driveFile: { driveFile: { id: 'd1', title: 'Конспект', alternateLink: 'https://drive/1' } } },
      { youtubeVideo: { id: 'y1', title: 'Урок', alternateLink: 'https://yt/1' } },
      { link: { url: 'https://example.org', title: 'Стаття' } },
      { form: { formUrl: 'https://forms/1', title: 'Тест' } },
    ]);

    expect(result.map((a) => a.kind)).toEqual(['drive', 'youtube', 'link', 'form']);
    expect(result[0]?.title).toBe('Конспект');
    expect(result[2]?.url).toBe('https://example.org');
  });

  it('falls back to the url when a link has no title', () => {
    expect(mapAttachments([{ link: { url: 'https://example.org' } }])[0]?.title).toBe('https://example.org');
  });

  it('keeps an unrecognized material rather than dropping it silently', () => {
    const r = mapAttachments([{}]);
    expect(r).toHaveLength(1);
    expect(r[0]?.kind).toBe('unknown');
  });
});
