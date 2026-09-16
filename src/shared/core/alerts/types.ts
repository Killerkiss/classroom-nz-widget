import type { AssignmentId } from '../../domain/ids';
import type { Assignment, CivilDate, Instant } from '../../domain/models';
import type { AlertSettings } from '../../domain/settings';

export type AlertReason = 'due_soon' | 'due_today' | 'overdue';

/**
 * What the engine remembers between runs, persisted so that a restart does not
 * re-fire an alert the student already saw.
 */
export interface AlertState {
  assignmentId: AssignmentId;
  /** The evening (school civil date) the counters below belong to. */
  eveningDate: CivilDate | null;
  /** Alerts fired during that evening. Reset when a new evening begins. */
  eveningFireCount: number;
  /** The most recent slot fired, so a slot is never fired twice. */
  lastFiredSlot: Instant | null;
  snoozedUntil: Instant | null;
  dismissedAt: Instant | null;
  /**
   * Identity of the thing being alerted about. When the due date moves or the work
   * comes back from the teacher this changes, which re-arms a dismissed alert.
   * Without it, "dismiss" would be permanently wrong.
   */
  armKey: string;
}

export interface AlertDecision {
  assignmentId: AssignmentId;
  reason: AlertReason;
  /** The scheduled slot this alert is for — not the instant it happened to run. */
  slotAt: Instant;
  assignmentTitle: string;
  subjectKey: string;
  dueAt?: Instant;
  /** Persist this before showing the notification. */
  nextState: AlertState;
}

export interface AlertEngineInput {
  now: Date;
  assignments: readonly Assignment[];
  settings: AlertSettings;
  timezone: string;
  states: Readonly<Record<string, AlertState>>;
}

export interface AlertEngineOutput {
  fire: AlertDecision[];
  /** Earliest instant at which this result could change. Drives the single timer. */
  nextWakeAt: Instant | null;
  /** States for assignments that are done or gone, safe to garbage collect. */
  clearedStateIds: string[];
}

export function emptyState(assignmentId: AssignmentId, armKey: string): AlertState {
  return {
    assignmentId,
    eveningDate: null,
    eveningFireCount: 0,
    lastFiredSlot: null,
    snoozedUntil: null,
    dismissedAt: null,
    armKey,
  };
}

/**
 * Identity of what we are alerting about. Deliberately readable rather than hashed,
 * so a persisted state file can be understood when something misbehaves.
 */
export function armKeyFor(a: Assignment): string {
  return `${a.dueAt ?? 'none'}|${a.submission.state}|${a.submission.locallyDone ? 'done' : 'open'}`;
}

export type { AlertSettings };
