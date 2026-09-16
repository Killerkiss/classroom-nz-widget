import type { NativeId, ProfileId, SourceId } from '@shared/domain/ids';
import type { Announcement, Assignment, CivilDate, Course, Lesson } from '@shared/domain/models';
import type { AuthStatus, Capability, ProviderHealth } from '@shared/ipc/contract';

export interface DateRange {
  /** Civil dates in the school timezone, inclusive. */
  from: CivilDate;
  to: CivilDate;
}

export interface FetchContext {
  signal: AbortSignal;
  now: Date;
  /** Bypass any provider-level HTTP caching. */
  force?: boolean;
}

export interface SchoolDataProvider {
  readonly source: SourceId;
  readonly profileId: ProfileId;
  readonly displayName: string;

  capabilities(): ReadonlySet<Capability>;
  health(): ProviderHealth;

  /** Never opens UI. Reports state only. */
  authStatus(): Promise<AuthStatus>;
  /** May open a window, so it is only ever called from an explicit user action. */
  authenticate(): Promise<void>;
  signOut(): Promise<void>;

  listCourses(ctx: FetchContext): Promise<Course[]>;
  listLessons(range: DateRange, ctx: FetchContext): Promise<Lesson[]>;
  listAssignments(range: DateRange, ctx: FetchContext): Promise<Assignment[]>;
  listAnnouncements(range: DateRange, ctx: FetchContext): Promise<Announcement[]>;

  /** Optional: Classroom can mark work done, nz.ua cannot. */
  markDone?(assignmentId: NativeId): Promise<void>;
}
