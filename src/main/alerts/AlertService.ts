import type { AssignmentId } from '@shared/domain/ids';
import type { Assignment } from '@shared/domain/models';
import { computeAlerts } from '@shared/core/alerts/engine';
import type { Clock } from '@shared/core/clock';
import type { CacheStore } from '@main/storage/cacheStore';
import type { SettingsStore } from '@main/storage/settingsStore';
import type { Scheduler } from '@main/sync/scheduler';
import type { Notifier } from './notifier';

const TIMER = 'alerts';

/**
 * The impure shell around the pure alert engine. It reads state, calls the engine,
 * persists the result, shows notifications, and arms one timer. It makes no
 * decisions of its own — all of those live in computeAlerts().
 */
export class AlertService {
  constructor(
    private readonly cache: CacheStore,
    private readonly settings: SettingsStore,
    private readonly scheduler: Scheduler,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
    private readonly onFired: (assignmentId: AssignmentId) => void,
  ) {}

  /** Safe to call as often as you like: the engine is idempotent within a slot. */
  evaluate(): void {
    const settings = this.settings.get();
    const assignments = this.withLocalDoneFlags(this.cache.read().assignments);

    const result = computeAlerts({
      now: this.clock.now(),
      assignments,
      settings: settings.alerts,
      timezone: settings.schedule.timezone,
      states: this.cache.getAlertStates(),
    });

    // Persist before notifying: a crash in between must under-notify, never double-notify.
    this.cache.putAlertStates(
      result.fire.map((d) => d.nextState),
      result.clearedStateIds,
    );

    for (const decision of result.fire) {
      this.notifier.show(decision, settings, () => this.onFired(decision.assignmentId));
    }

    this.scheduler.wakeAt(TIMER, result.nextWakeAt, () => this.evaluate());
  }

  snooze(assignmentId: AssignmentId, minutes: number): void {
    const state = this.cache.getAlertStates()[assignmentId];
    if (!state) return;
    const until = new Date(this.clock.now().getTime() + minutes * 60_000).toISOString();
    this.cache.putAlertStates([{ ...state, snoozedUntil: until }]);
    this.evaluate();
  }

  dismiss(assignmentId: AssignmentId): void {
    const state = this.cache.getAlertStates()[assignmentId];
    if (!state) return;
    this.cache.putAlertStates([{ ...state, dismissedAt: this.clock.now().toISOString() }]);
    this.evaluate();
  }

  markDone(assignmentId: AssignmentId, done: boolean): void {
    this.cache.setLocallyDone(assignmentId, done);
    this.evaluate();
  }

  stop(): void {
    this.scheduler.cancel(TIMER);
  }

  /** Overlay the local "done" flags, which are ours and not the provider's. */
  private withLocalDoneFlags(assignments: Assignment[]): Assignment[] {
    const done = this.cache.read().locallyDone;
    if (Object.keys(done).length === 0) return assignments;
    return assignments.map((a) =>
      done[a.id] ? { ...a, submission: { ...a.submission, locallyDone: true } } : a,
    );
  }
}
