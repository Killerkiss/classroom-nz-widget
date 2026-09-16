import type { AssignmentId, CourseId, LessonId, NativeId, ProfileId, SourceId } from './ids';

/**
 * An ISO-8601 instant in UTC, e.g. '2026-09-16T15:00:00.000Z'.
 * Always an absolute point in time — never a wall-clock reading.
 */
export type Instant = string;

/**
 * A civil date in the *school's* timezone, 'YYYY-MM-DD'.
 * Deliberately not a Date: "which school day is this" is a calendar question, and
 * answering it with an instant is how off-by-one-day bugs get in.
 */
export type CivilDate = string;

/** 'HH:mm' wall clock in the school's timezone. */
export type CivilTime = string;

/** A pointer back to the record in the upstream system it came from. */
export interface SourceRef {
  source: SourceId;
  profileId: ProfileId;
  nativeId: NativeId;
  /** Deep link to open this in a browser. Must be https: before it reaches openExternal. */
  webUrl?: string;
  fetchedAt: Instant;
}

export interface Course {
  id: CourseId;
  name: string;
  /**
   * Normalized subject slug used to match the same subject across systems, e.g.
   * 'Алгебра та початки аналізу' and 'Алгебра' both map to 'algebra'.
   */
  subjectKey: string;
  section?: string;
  teacher?: string;
  room?: string;
  /** Course-level Meet room, where the source exposes one. */
  meetLink?: string;
  /** Stable per-course accent colour for the UI. */
  color?: string;
  refs: SourceRef[];
}

export type AttachmentKind = 'file' | 'link' | 'youtube' | 'form' | 'drive' | 'unknown';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  title: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  thumbnailUrl?: string;
}

export type SubmissionState =
  /** The source cannot tell us — common for nz.ua. Distinct from 'not_started'. */
  | 'unknown'
  | 'not_started'
  /** Classroom: assigned and has draft work attached. */
  | 'in_progress'
  | 'submitted'
  /** Returned by the teacher, possibly for revision — this re-arms alerts. */
  | 'returned'
  | 'graded'
  /** Past due and not submitted. */
  | 'missing';

/** Submission states in which the work is done and should never alert. */
export const TERMINAL_SUBMISSION_STATES: readonly SubmissionState[] = [
  'submitted',
  'graded',
] as const;

export interface Grade {
  value: number | string;
  max?: number;
  /** nz.ua uses the Ukrainian 12-point scale; Classroom uses raw points. */
  scale: 'points' | 'nz12' | 'letter' | 'other';
  gradedAt?: Instant;
}

export interface Submission {
  state: SubmissionState;
  submittedAt?: Instant;
  late?: boolean;
  grade?: Grade;
  /**
   * Locally marked done by the user. Silences alerts without needing an OAuth
   * write scope — it solves the actual problem at a fraction of the risk.
   */
  locallyDone?: boolean;
}

export interface Assignment {
  /** Equal to dedupeKey, so a merged item keeps one stable identity. */
  id: AssignmentId;
  dedupeKey: string;
  courseId: CourseId;
  subjectKey: string;
  title: string;
  description?: string;
  /** Absent means no due date, which means it never alerts. */
  dueAt?: Instant;
  /** True when the source gave a date but no time, so it is due end-of-day. */
  dueIsAllDay: boolean;
  assignedAt?: Instant;
  submission: Submission;
  attachments: Attachment[];
  /** More than one entry means this was merged across sources. */
  refs: SourceRef[];
  /**
   * Which source won each contested field. Surfaced in the detail panel so that a
   * disagreement between Classroom and nz.ua is visible rather than silently resolved.
   */
  provenance: Partial<Record<keyof Assignment, SourceId>>;
  /** Possible-but-unconfirmed duplicates, pending a one-time user confirmation. */
  relatedIds?: AssignmentId[];
}

export interface Lesson {
  id: LessonId;
  date: CivilDate;
  /** 1-based bell period. */
  period: number;
  startsAt: Instant;
  endsAt: Instant;
  subjectKey: string;
  courseId?: CourseId;
  title: string;
  room?: string;
  teacher?: string;
  meetLink?: string;
  meetLinkSource?: 'calendar' | 'nz' | 'override' | 'course';
  /** Assignments due at or for this lesson. */
  homeworkIds: AssignmentId[];
  cancelled?: boolean;
  note?: string;
  refs: SourceRef[];
}

export interface Announcement {
  id: string;
  courseId: CourseId;
  text: string;
  postedAt: Instant;
  attachments: Attachment[];
  refs: SourceRef[];
}
