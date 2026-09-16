import type { Announcement, Assignment, Course, Lesson } from '@shared/domain/models';
import type { ProviderHealth, Snapshot } from '@shared/ipc/contract';
import { selectScheduleDay } from '@shared/core/scheduleView';
import { addCivilDays, civilDateIn } from '@shared/core/timezone';
import type { Clock } from '@shared/core/clock';
import { log } from '@main/logging';
import type { CacheStore } from '@main/storage/cacheStore';
import type { SettingsStore } from '@main/storage/settingsStore';
import type { DateRange, SchoolDataProvider } from '@main/providers/SchoolDataProvider';

/** How far around today to fetch. Wide enough for overdue work and next week's plan. */
const LOOKBACK_DAYS = 30;
const LOOKAHEAD_DAYS = 14;

export class SyncService {
  private inFlight: AbortController | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly cache: CacheStore,
    private readonly clock: Clock,
    private readonly getProviders: () => SchoolDataProvider[],
    private readonly onSnapshot: (snapshot: Snapshot) => void,
  ) {}

  /** Build a snapshot from cache without touching the network. */
  snapshot(): Snapshot {
    const settings = this.settings.get();
    const data = this.cache.read();
    const now = this.clock.now();

    const doneFlags = data.locallyDone;
    const assignments = data.assignments.map((a) =>
      doneFlags[a.id] ? { ...a, submission: { ...a.submission, locallyDone: true } } : a,
    );

    return {
      generatedAt: data.updatedAt ?? now.toISOString(),
      selection: selectScheduleDay(now, settings.schedule),
      lessons: data.lessons,
      assignments,
      courses: data.courses,
      health: data.health,
      stale: this.isStale(data.updatedAt, now),
    };
  }

  async refresh(force = false): Promise<void> {
    // A newer refresh supersedes one already running.
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    const settings = this.settings.get();
    const now = this.clock.now();
    const today = civilDateIn(now, settings.schedule.timezone);
    const range: DateRange = {
      from: addCivilDays(today, -LOOKBACK_DAYS),
      to: addCivilDays(today, LOOKAHEAD_DAYS),
    };
    const ctx = { signal: controller.signal, now, force };

    const providers = this.getProviders();
    if (providers.length === 0) {
      this.onSnapshot(this.snapshot());
      return;
    }

    // Each provider is settled independently: one source being down must never
    // discard data the other successfully returned.
    const settled = await Promise.allSettled(
      providers.map(async (p) => ({
        provider: p,
        courses: await p.listCourses(ctx),
        assignments: await p.listAssignments(range, ctx),
        lessons: await p.listLessons(range, ctx),
        announcements: await p.listAnnouncements(range, ctx),
      })),
    );

    if (controller.signal.aborted) return;

    const courses: Course[] = [];
    const assignments: Assignment[] = [];
    const lessons: Lesson[] = [];
    const announcements: Announcement[] = [];
    const health: ProviderHealth[] = [];

    settled.forEach((outcome, i) => {
      const provider = providers[i];
      if (outcome.status === 'rejected') {
        log.error(
          `[sync] provider "${provider?.displayName}" (${provider?.source}) failed: ${String(outcome.reason)}`,
        );
        if (provider) health.push(provider.health());
        return;
      }
      courses.push(...outcome.value.courses);
      assignments.push(...outcome.value.assignments);
      lessons.push(...outcome.value.lessons);
      announcements.push(...outcome.value.announcements);
      health.push(outcome.value.provider.health());
    });

    // Partial results are kept deliberately: half a schedule beats none, and the
    // health records tell the UI which half is missing.
    this.cache.update({
      updatedAt: now.toISOString(),
      courses,
      assignments,
      lessons,
      announcements,
      health,
    });

    this.inFlight = null;
    this.onSnapshot(this.snapshot());
  }

  private isStale(updatedAt: string | null, now: Date): boolean {
    if (!updatedAt) return true;
    const interval = this.settings.get().sync.refreshIntervalMinutes * 60_000;
    return now.getTime() - new Date(updatedAt).getTime() > interval * 2;
  }
}
