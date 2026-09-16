import { describe, expect, it } from 'vitest';
import { computeAlerts, eveningSlots } from '@shared/core/alerts/engine';
import { armKeyFor, emptyState } from '@shared/core/alerts/types';
import type { AlertState } from '@shared/core/alerts/types';
import { DEFAULT_SETTINGS } from '@shared/domain/settings';
import type { Assignment, SubmissionState } from '@shared/domain/models';
import { asAssignmentId, asCourseId } from '@shared/domain/ids';

const TZ = 'Europe/Kyiv';
const alerts = DEFAULT_SETTINGS.alerts; // 18:00, hourly, cap 4, quiet 22:00–07:00

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: asAssignmentId('hw-1'),
    dedupeKey: 'hw-1',
    courseId: asCourseId('course-1'),
    subjectKey: 'algebra',
    title: 'Вправи 12–18',
    dueIsAllDay: true,
    submission: { state: 'not_started' as SubmissionState },
    attachments: [],
    refs: [],
    provenance: {},
    // Due Thursday 2026-09-17, end of day Kyiv.
    dueAt: '2026-09-17T20:59:00.000Z',
    ...over,
  };
}

function run(nowUtc: string, over: Partial<Parameters<typeof computeAlerts>[0]> = {}) {
  return computeAlerts({
    now: new Date(nowUtc),
    assignments: [assignment()],
    settings: alerts,
    timezone: TZ,
    states: {},
    ...over,
  });
}

/** Kyiv in September is UTC+3, so 18:00 local = 15:00Z. */
const SLOT_18 = '2026-09-16T15:00:00.000Z';
const SLOT_19 = '2026-09-16T16:00:00.000Z';
const SLOT_20 = '2026-09-16T17:00:00.000Z';
const SLOT_21 = '2026-09-16T18:00:00.000Z';

describe('the 18:00 start', () => {
  it('does not fire at 17:59', () => {
    expect(run('2026-09-16T14:59:00Z').fire).toHaveLength(0);
  });

  it('fires at exactly 18:00', () => {
    const r = run('2026-09-16T15:00:00Z');
    expect(r.fire).toHaveLength(1);
    expect(r.fire[0]).toMatchObject({ reason: 'due_soon', slotAt: SLOT_18 });
  });

  it('wakes at 18:00 when run before it', () => {
    expect(run('2026-09-16T10:00:00Z').nextWakeAt).toBe(SLOT_18);
  });
});

describe('hourly repetition and the 4-per-evening cap', () => {
  it('walks 18, 19, 20, 21 then goes silent', () => {
    let states: Record<string, AlertState> = {};
    const fired: string[] = [];

    for (const at of ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00']) {
      const r = computeAlerts({
        now: new Date(`2026-09-16T${at}:00Z`),
        assignments: [assignment()],
        settings: alerts,
        timezone: TZ,
        states,
      });
      for (const d of r.fire) {
        fired.push(d.slotAt);
        states = { ...states, [d.assignmentId]: d.nextState };
      }
    }

    expect(fired).toEqual([SLOT_18, SLOT_19, SLOT_20, SLOT_21]);
  });

  it('points nextWakeAt at tomorrow evening once capped', () => {
    const capped: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment())),
      eveningDate: '2026-09-16',
      eveningFireCount: 4,
      lastFiredSlot: SLOT_21,
    };
    const r = run('2026-09-16T19:00:00Z', { states: { 'hw-1': capped } });
    expect(r.fire).toHaveLength(0);
    expect(r.nextWakeAt).toBe('2026-09-17T15:00:00.000Z'); // 18:00 next day
  });

  it('resets the cap on the next evening', () => {
    const capped: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment({ dueAt: '2026-09-18T20:59:00.000Z' }))),
      eveningDate: '2026-09-16',
      eveningFireCount: 4,
      lastFiredSlot: SLOT_21,
    };
    const r = computeAlerts({
      now: new Date('2026-09-17T15:00:00Z'),
      assignments: [assignment({ dueAt: '2026-09-18T20:59:00.000Z' })],
      settings: alerts,
      timezone: TZ,
      states: { 'hw-1': capped },
    });
    expect(r.fire).toHaveLength(1);
    expect(r.fire[0]?.nextState.eveningFireCount).toBe(1);
  });
});

describe('missed slots collapse to one notification', () => {
  it('fires once after sleeping through 18:00 to 21:00', () => {
    const r = run('2026-09-16T18:30:00Z'); // 21:30 Kyiv, four slots already passed
    expect(r.fire).toHaveLength(1);
    expect(r.fire[0]?.slotAt).toBe(SLOT_21); // only the most recent
  });

  it('fires once after sleeping from 18:00 to 23:00', () => {
    const r = run('2026-09-16T20:00:00Z'); // 23:00 Kyiv, inside quiet hours
    expect(r.fire).toHaveLength(1);
    expect(r.fire[0]?.slotAt).toBe(SLOT_21);
  });
});

describe('idempotence', () => {
  it('running twice at the same instant fires exactly once', () => {
    const first = run('2026-09-16T15:00:00Z');
    expect(first.fire).toHaveLength(1);

    const states = { 'hw-1': first.fire[0]!.nextState };
    const second = run('2026-09-16T15:00:00Z', { states });
    expect(second.fire).toHaveLength(0);
  });

  it('does not re-fire across a restart', () => {
    const first = run('2026-09-16T15:00:00Z');
    const states = { 'hw-1': first.fire[0]!.nextState };
    // Simulate restarts at several instants within the same slot.
    for (const at of ['15:00', '15:10', '15:59']) {
      expect(run(`2026-09-16T${at}:00Z`, { states }).fire).toHaveLength(0);
    }
  });
});

describe('snooze and dismiss', () => {
  it('suppresses while snoozed, then resumes', () => {
    const snoozed: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment())),
      snoozedUntil: '2026-09-16T17:30:00.000Z',
    };
    expect(run('2026-09-16T16:00:00Z', { states: { 'hw-1': snoozed } }).fire).toHaveLength(0);
    expect(run('2026-09-16T18:00:00Z', { states: { 'hw-1': snoozed } }).fire).toHaveLength(1);
  });

  it('wakes when the snooze expires', () => {
    const snoozed: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment())),
      snoozedUntil: '2026-09-16T17:30:00.000Z',
    };
    expect(run('2026-09-16T16:00:00Z', { states: { 'hw-1': snoozed } }).nextWakeAt)
      .toBe('2026-09-16T17:30:00.000Z');
  });

  it('dismiss is terminal for the current arming', () => {
    const dismissed: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment())),
      dismissedAt: '2026-09-16T15:05:00.000Z',
    };
    expect(run('2026-09-16T17:00:00Z', { states: { 'hw-1': dismissed } }).fire).toHaveLength(0);
    expect(run('2026-09-17T15:00:00Z', { states: { 'hw-1': dismissed } }).fire).toHaveLength(0);
  });
});

describe('re-arming when the assignment changes', () => {
  it('re-arms a dismissed alert when the due date moves', () => {
    const dismissed: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment())),
      dismissedAt: '2026-09-16T15:05:00.000Z',
    };
    const moved = assignment({ dueAt: '2026-09-18T20:59:00.000Z' });
    const r = computeAlerts({
      now: new Date('2026-09-17T15:00:00Z'),
      assignments: [moved],
      settings: alerts,
      timezone: TZ,
      states: { 'hw-1': dismissed },
    });
    expect(r.fire).toHaveLength(1);
  });

  it('re-arms when work is returned for revision', () => {
    const dismissed: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment({ submission: { state: 'submitted' } }))),
      dismissedAt: '2026-09-16T15:05:00.000Z',
    };
    const returned = assignment({ submission: { state: 'returned' } });
    const r = run('2026-09-16T15:00:00Z', {
      assignments: [returned],
      states: { 'hw-1': dismissed },
    });
    expect(r.fire).toHaveLength(1);
  });
});

describe('terminal states stay silent', () => {
  it.each<SubmissionState>(['submitted', 'graded'])('never alerts when %s', (state) => {
    // The realistic sequence: it alerted last night, and the work has since landed.
    const r = run('2026-09-16T15:00:00Z', {
      assignments: [assignment({ submission: { state } })],
      states: { 'hw-1': emptyState(asAssignmentId('hw-1'), 'stale-arm-key') },
    });
    expect(r.fire).toHaveLength(0);
    expect(r.clearedStateIds).toContain('hw-1');
  });

  it('never alerts when locally marked done', () => {
    const a = assignment({ submission: { state: 'not_started', locallyDone: true } });
    expect(run('2026-09-16T15:00:00Z', { assignments: [a] }).fire).toHaveLength(0);
  });

  it('alerts when returned for revision', () => {
    const a = assignment({ submission: { state: 'returned' } });
    expect(run('2026-09-16T15:00:00Z', { assignments: [a] }).fire).toHaveLength(1);
  });
});

describe('reasons', () => {
  it('is due_soon the evening before', () => {
    expect(run('2026-09-16T15:00:00Z').fire[0]?.reason).toBe('due_soon');
  });

  it('is due_today on the due date', () => {
    expect(run('2026-09-17T15:00:00Z').fire[0]?.reason).toBe('due_today');
  });

  it('is overdue after the due date', () => {
    expect(run('2026-09-18T15:00:00Z').fire[0]?.reason).toBe('overdue');
  });

  it('stays silent outside the lead window', () => {
    const far = assignment({ dueAt: '2026-09-25T20:59:00.000Z' });
    expect(run('2026-09-16T15:00:00Z', { assignments: [far] }).fire).toHaveLength(0);
  });

  it('respects a wider leadDays', () => {
    const far = assignment({ dueAt: '2026-09-19T20:59:00.000Z' });
    const r = run('2026-09-16T15:00:00Z', {
      assignments: [far],
      settings: { ...alerts, leadDays: 3 },
    });
    expect(r.fire[0]?.reason).toBe('due_soon');
  });

  it('never alerts without a due date', () => {
    const r = run('2026-09-16T15:00:00Z', { assignments: [assignment({ dueAt: undefined })] });
    expect(r.fire).toHaveLength(0);
  });

  it('honours alertOnOverdue = false', () => {
    const r = run('2026-09-18T15:00:00Z', { settings: { ...alerts, alertOnOverdue: false } });
    expect(r.fire).toHaveLength(0);
  });
});

describe('quiet hours', () => {
  it('skips slots inside the quiet window rather than deferring them', () => {
    // Start at 21:00 with a cap of 4: slots 21, 22, 23, 00 — the last three are quiet.
    const late = { ...alerts, startHour: 21 };
    const slots = eveningSlots('2026-09-16', late, TZ);
    expect(slots).toHaveLength(3); // never spills past midnight

    const r = run('2026-09-16T21:30:00Z', { settings: late }); // 00:30 Kyiv on the 17th
    expect(r.fire).toHaveLength(0);
  });

  it('fires normally when quiet hours are disabled', () => {
    const r = run('2026-09-16T20:00:00Z', {
      settings: { ...alerts, startHour: 21, quietHours: null },
    });
    expect(r.fire).toHaveLength(1);
  });
});

describe('the master switch', () => {
  it('fires nothing and clears state when disabled', () => {
    const r = run('2026-09-16T15:00:00Z', {
      settings: { ...alerts, enabled: false },
      states: { 'hw-1': emptyState(asAssignmentId('hw-1'), 'x') },
    });
    expect(r.fire).toHaveLength(0);
    expect(r.nextWakeAt).toBeNull();
    expect(r.clearedStateIds).toEqual(['hw-1']);
  });
});

describe('garbage collection', () => {
  it('clears state for assignments that vanished upstream', () => {
    const r = run('2026-09-16T15:00:00Z', {
      assignments: [],
      states: { 'gone': emptyState(asAssignmentId('gone'), 'x') },
    });
    expect(r.clearedStateIds).toContain('gone');
  });
});

describe('DST boundaries', () => {
  it('fires at 18:00 local on the autumn fall-back day', () => {
    // 2026-10-25, Kyiv drops to UTC+2, so 18:00 local = 16:00Z.
    const a = assignment({ dueAt: '2026-10-26T21:59:00.000Z' });
    const r = computeAlerts({
      now: new Date('2026-10-25T16:00:00Z'),
      assignments: [a],
      settings: alerts,
      timezone: TZ,
      states: {},
    });
    expect(r.fire).toHaveLength(1);
    expect(r.fire[0]?.slotAt).toBe('2026-10-25T16:00:00.000Z');
  });

  it('fires at 18:00 local on the spring-forward day', () => {
    // 2027-03-28, Kyiv moves to UTC+3, so 18:00 local = 15:00Z.
    const a = assignment({ dueAt: '2027-03-29T20:59:00.000Z' });
    const r = computeAlerts({
      now: new Date('2027-03-28T15:00:00Z'),
      assignments: [a],
      settings: alerts,
      timezone: TZ,
      states: {},
    });
    expect(r.fire).toHaveLength(1);
    expect(r.fire[0]?.slotAt).toBe('2027-03-28T15:00:00.000Z');
  });

  it('produces four distinct hourly slots across a DST day', () => {
    const slots = eveningSlots('2026-10-25', alerts, TZ).map((d) => d.toISOString());
    expect(new Set(slots).size).toBe(4);
    for (let i = 1; i < slots.length; i += 1) {
      const gap = new Date(slots[i]!).getTime() - new Date(slots[i - 1]!).getTime();
      expect(gap).toBe(3_600_000);
    }
  });
});

describe('multiple assignments', () => {
  it('alerts each independently', () => {
    const a = assignment();
    const b = assignment({ id: asAssignmentId('hw-2'), dedupeKey: 'hw-2', title: 'Есе' });
    const r = run('2026-09-16T15:00:00Z', { assignments: [a, b] });
    expect(r.fire.map((f) => f.assignmentId).sort()).toEqual(['hw-1', 'hw-2']);
  });

  it('does not let one capped assignment silence another', () => {
    const capped: AlertState = {
      ...emptyState(asAssignmentId('hw-1'), armKeyFor(assignment())),
      eveningDate: '2026-09-16',
      eveningFireCount: 4,
      lastFiredSlot: SLOT_21,
    };
    const b = assignment({ id: asAssignmentId('hw-2'), dedupeKey: 'hw-2' });
    const r = run('2026-09-16T15:00:00Z', {
      assignments: [assignment(), b],
      states: { 'hw-1': capped },
    });
    expect(r.fire.map((f) => f.assignmentId)).toEqual(['hw-2']);
  });
});
