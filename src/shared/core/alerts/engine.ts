import type { Assignment, CivilDate, Instant } from '../../domain/models';
import { TERMINAL_SUBMISSION_STATES } from '../../domain/models';
import type { AlertSettings } from '../../domain/settings';
import { addCivilDays, civilDateIn, instantAtHour, toInstant } from '../timezone';
import { isQuiet } from './quietHours';
import type {
  AlertDecision,
  AlertEngineInput,
  AlertEngineOutput,
  AlertReason,
  AlertState,
} from './types';
import { armKeyFor, emptyState } from './types';

/**
 * Decide which alerts should fire right now.
 *
 * Pure: same input, same output, no timers, no ambient clock. The impure shell
 * persists `nextState`, shows the notifications, and sets one timer for `nextWakeAt`.
 */
export function computeAlerts(input: AlertEngineInput): AlertEngineOutput {
  const { now, assignments, settings, timezone: tz, states } = input;

  const fire: AlertDecision[] = [];
  const clearedStateIds: string[] = [];
  const wakeCandidates: number[] = [];

  if (!settings.enabled) {
    return { fire, nextWakeAt: null, clearedStateIds: Object.keys(states) };
  }

  const today = civilDateIn(now, tz);
  const seen = new Set<string>();

  for (const a of assignments) {
    seen.add(a.id);

    if (isDone(a) || !a.dueAt) {
      if (states[a.id]) clearedStateIds.push(a.id);
      continue;
    }

    const reason = reasonFor(a, today, tz, settings);
    if (!reason) continue;

    // Re-arm from scratch whenever the due date or submission state changed.
    const armKey = armKeyFor(a);
    const prior = states[a.id];
    const state = prior && prior.armKey === armKey ? prior : emptyState(a.id, armKey);

    if (state.dismissedAt) continue;

    if (state.snoozedUntil) {
      const until = new Date(state.snoozedUntil).getTime();
      if (until > now.getTime()) {
        wakeCandidates.push(until);
        continue;
      }
    }

    const slots = eveningSlots(today, settings, tz);

    // A new evening resets the per-evening cap.
    const freshEvening = state.eveningDate !== today;
    const firedThisEvening = freshEvening ? 0 : state.eveningFireCount;

    if (firedThisEvening >= settings.maxAlertsPerEvening) {
      // Silent until the first slot of the next evening.
      wakeCandidates.push(firstSlotOfNextEvening(today, settings, tz).getTime());
      continue;
    }

    const lastFired = state.lastFiredSlot ? new Date(state.lastFiredSlot).getTime() : 0;

    // Collapse missed slots: if the machine slept through several, fire only the
    // most recent one. A burst of five is how notifications get muted forever.
    let due: Date | null = null;
    for (const slot of slots) {
      const t = slot.getTime();
      if (t > now.getTime()) {
        wakeCandidates.push(t);
        break;
      }
      if (t > lastFired && !isQuiet(slot, settings, tz)) due = slot;
    }

    if (!due) {
      if (!slots.some((s) => s.getTime() > now.getTime())) {
        wakeCandidates.push(firstSlotOfNextEvening(today, settings, tz).getTime());
      }
      continue;
    }

    const nextState: AlertState = {
      ...state,
      eveningDate: today,
      eveningFireCount: firedThisEvening + 1,
      lastFiredSlot: toInstant(due),
      snoozedUntil: null,
    };

    fire.push({
      assignmentId: a.id,
      reason,
      slotAt: toInstant(due),
      assignmentTitle: a.title,
      subjectKey: a.subjectKey,
      dueAt: a.dueAt,
      nextState,
    });

    const remaining = settings.maxAlertsPerEvening - nextState.eveningFireCount;
    const upcoming = slots.find((s) => s.getTime() > now.getTime());
    if (remaining > 0 && upcoming) wakeCandidates.push(upcoming.getTime());
    else wakeCandidates.push(firstSlotOfNextEvening(today, settings, tz).getTime());
  }

  // Assignments that vanished upstream leave their state behind; collect it.
  for (const id of Object.keys(states)) {
    if (!seen.has(id) && !clearedStateIds.includes(id)) clearedStateIds.push(id);
  }

  const nextWakeAt = wakeCandidates.length > 0 ? toInstant(new Date(Math.min(...wakeCandidates))) : null;

  return { fire, nextWakeAt, clearedStateIds };
}

function isDone(a: Assignment): boolean {
  return (
    a.submission.locallyDone === true ||
    TERMINAL_SUBMISSION_STATES.includes(a.submission.state)
  );
}

function reasonFor(
  a: Assignment,
  today: CivilDate,
  tz: string,
  settings: AlertSettings,
): AlertReason | null {
  const dueDate = civilDateIn(new Date(a.dueAt as Instant), tz);

  if (dueDate < today) return settings.alertOnOverdue ? 'overdue' : null;
  if (dueDate === today) return settings.alertOnDueToday ? 'due_today' : null;

  // Due in the future: only within the lead window.
  return dueDate <= addCivilDays(today, settings.leadDays) ? 'due_soon' : null;
}

/**
 * The slots for one evening: startHour, then every repeatEveryMinutes, capped at
 * maxAlertsPerEvening and never spilling past midnight.
 *
 * Slots are anchored to the hour rather than measured from the previous alert. That
 * is what makes restarts, sleep and clock jumps harmless — a slot either has been
 * fired or has not, regardless of how many times the engine runs.
 */
export function eveningSlots(date: CivilDate, settings: AlertSettings, tz: string): Date[] {
  const first = instantAtHour(date, settings.startHour, tz);
  const endOfDay = instantAtHour(addCivilDays(date, 1), 0, tz).getTime();
  const slots: Date[] = [];

  for (let i = 0; i < settings.maxAlertsPerEvening; i += 1) {
    const t = first.getTime() + i * settings.repeatEveryMinutes * 60_000;
    if (t >= endOfDay) break;
    slots.push(new Date(t));
  }
  return slots;
}

function firstSlotOfNextEvening(today: CivilDate, settings: AlertSettings, tz: string): Date {
  return instantAtHour(addCivilDays(today, 1), settings.startHour, tz);
}
