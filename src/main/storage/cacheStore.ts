import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { AlertState } from '@shared/core/alerts/types';
import type { Announcement, Assignment, Course, Instant, Lesson } from '@shared/domain/models';
import type { ProviderHealth } from '@shared/ipc/contract';
import type { MergeOverride, MergeSuggestion } from '@shared/core/merge/mergeAssignments';

export const CACHE_SCHEMA_VERSION = 2;

export interface CachedData {
  schemaVersion: number;
  updatedAt: Instant | null;
  courses: Course[];
  lessons: Lesson[];
  assignments: Assignment[];
  announcements: Announcement[];
  health: ProviderHealth[];
  alertStates: Record<string, AlertState>;
  /** Locally marked done, keyed by assignment id. */
  locallyDone: Record<string, boolean>;
  /**
   * The user's confirmed decisions about whether two assignments are the same
   * homework. Asked once, then honoured forever.
   */
  mergeOverrides: MergeOverride[];
  /** Possible duplicates awaiting a decision. Recomputed on every sync. */
  mergeSuggestions: MergeSuggestion[];
}

function empty(): CachedData {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    updatedAt: null,
    courses: [],
    lessons: [],
    assignments: [],
    announcements: [],
    health: [],
    alertStates: {},
    locallyDone: {},
    mergeOverrides: [],
    mergeSuggestions: [],
  };
}

/**
 * The cache exists so the widget paints instantly and keeps working offline. It
 * holds only mapped domain objects — never raw API responses, which carry class
 * rosters and grades.
 *
 * JSON for now. The interface is what matters; SQLite lands in M5 once the schema
 * has stopped moving, so native-module packaging pain arrives late rather than early.
 */
export class CacheStore {
  private readonly file: string;
  private data: CachedData;

  constructor(file = join(app.getPath('userData'), 'cache.json')) {
    this.file = file;
    this.data = this.load();
  }

  get schemaVersion(): number {
    return CACHE_SCHEMA_VERSION;
  }

  read(): CachedData {
    return this.data;
  }

  update(patch: Partial<CachedData>): CachedData {
    this.data = { ...this.data, ...patch, schemaVersion: CACHE_SCHEMA_VERSION };
    this.persist();
    return this.data;
  }

  getAlertStates(): Record<string, AlertState> {
    return this.data.alertStates;
  }

  putAlertStates(states: AlertState[], clearedIds: string[] = []): void {
    const next = { ...this.data.alertStates };
    for (const s of states) next[s.assignmentId] = s;
    for (const id of clearedIds) delete next[id];
    this.update({ alertStates: next });
  }

  getMergeOverrides(): MergeOverride[] {
    return this.data.mergeOverrides;
  }

  /** Record a user's decision, replacing any earlier ruling on the same pair. */
  putMergeOverride(override: MergeOverride): void {
    const key = [override.a, override.b].sort().join('|');
    const rest = this.data.mergeOverrides.filter((o) => [o.a, o.b].sort().join('|') !== key);
    this.update({ mergeOverrides: [...rest, override] });
  }

  setLocallyDone(assignmentId: string, done: boolean): void {
    const next = { ...this.data.locallyDone };
    if (done) next[assignmentId] = true;
    else delete next[assignmentId];
    this.update({ locallyDone: next });
  }

  private load(): CachedData {
    if (!existsSync(this.file)) return empty();

    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as CachedData;

      // A cache written by a newer build. Do not attempt to migrate downwards —
      // the cache is disposable, and treating it so removes a class of corruption bugs.
      if (parsed.schemaVersion > CACHE_SCHEMA_VERSION) {
        renameSync(this.file, `${this.file}.v${parsed.schemaVersion}.bak`);
        return empty();
      }
      return { ...empty(), ...parsed, schemaVersion: CACHE_SCHEMA_VERSION };
    } catch {
      return empty();
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Write-then-rename so a crash mid-write cannot leave a truncated cache.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // A cache we cannot write is a degraded experience, not a failure worth crashing for.
    }
  }
}
