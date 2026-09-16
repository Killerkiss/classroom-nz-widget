import type { ProfileId } from '@shared/domain/ids';
import { asAssignmentId, asCourseId, asNativeId, namespacedId } from '@shared/domain/ids';
import type {
  Announcement,
  Assignment,
  Attachment,
  Course,
  Instant,
  SourceRef,
  Submission,
  SubmissionState,
} from '@shared/domain/models';
import { normalizeSubject } from '@shared/core/merge/subjectKey';
import type { GAnnouncement, GCourse, GCourseWork, GMaterial, GStudentSubmission } from './types';

const SOURCE = 'google-classroom' as const;

function ref(profileId: ProfileId, nativeId: string, fetchedAt: Instant, webUrl?: string): SourceRef {
  return { source: SOURCE, profileId, nativeId: asNativeId(nativeId), webUrl, fetchedAt };
}

export function mapCourse(
  g: GCourse,
  profileId: ProfileId,
  fetchedAt: Instant,
  aliases: Record<string, string>,
): Course {
  return {
    id: asCourseId(namespacedId(SOURCE, profileId, g.id)),
    name: g.name,
    subjectKey: normalizeSubject(g.name, aliases),
    section: g.section,
    room: g.room,
    refs: [ref(profileId, g.id, fetchedAt, g.alternateLink)],
  };
}

/**
 * Classroom gives due date and time in UTC, with dueTime absent when the work is
 * due at end of day. That distinction matters: an all-day item must not be treated
 * as due at 00:00, which would make it overdue from the moment it is set.
 */
export function mapDueAt(work: GCourseWork): { dueAt?: Instant; dueIsAllDay: boolean } {
  if (!work.dueDate) return { dueIsAllDay: false };

  const { year, month, day } = work.dueDate;
  const t = work.dueTime;

  if (!t || (t.hours === undefined && t.minutes === undefined)) {
    // End of the UTC day, so it stays "due today" for the whole day.
    return { dueAt: new Date(Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString(), dueIsAllDay: true };
  }

  return {
    dueAt: new Date(Date.UTC(year, month - 1, day, t.hours ?? 0, t.minutes ?? 0, t.seconds ?? 0)).toISOString(),
    dueIsAllDay: false,
  };
}

export function mapSubmissionState(
  submission: GStudentSubmission | undefined,
  dueAt: Instant | undefined,
  now: Date,
): Submission {
  if (!submission) {
    return { state: overdueOr('not_started', dueAt, now) };
  }

  const graded = submission.assignedGrade !== undefined;
  let state: SubmissionState;

  switch (submission.state) {
    case 'TURNED_IN':
      state = 'submitted';
      break;
    case 'RETURNED':
      // Returned with a grade is finished; returned without one is a revision request.
      state = graded ? 'graded' : 'returned';
      break;
    case 'CREATED':
    case 'RECLAIMED_BY_STUDENT':
      state = overdueOr('in_progress', dueAt, now);
      break;
    case 'NEW':
      state = overdueOr('not_started', dueAt, now);
      break;
    default:
      state = overdueOr('unknown', dueAt, now);
  }

  const result: Submission = { state };
  if (submission.late !== undefined) result.late = submission.late;
  if (submission.updateTime && (state === 'submitted' || state === 'graded')) {
    result.submittedAt = submission.updateTime;
  }
  if (graded) {
    result.grade = { value: submission.assignedGrade as number, scale: 'points' };
  }
  return result;
}

/** Unsubmitted work past its due date is 'missing', which is what drives alerts. */
function overdueOr(fallback: SubmissionState, dueAt: Instant | undefined, now: Date): SubmissionState {
  if (dueAt && new Date(dueAt).getTime() < now.getTime()) return 'missing';
  return fallback;
}

export function mapAttachments(materials: GMaterial[] | undefined): Attachment[] {
  if (!materials) return [];

  return materials.flatMap((m, index): Attachment[] => {
    if (m.driveFile?.driveFile) {
      const f = m.driveFile.driveFile;
      return [{ id: f.id, kind: 'drive', title: f.title ?? 'Файл', url: f.alternateLink, thumbnailUrl: f.thumbnailUrl }];
    }
    if (m.youtubeVideo) {
      const v = m.youtubeVideo;
      return [{ id: v.id, kind: 'youtube', title: v.title ?? 'Відео', url: v.alternateLink, thumbnailUrl: v.thumbnailUrl }];
    }
    if (m.link) {
      return [{ id: `link-${index}`, kind: 'link', title: m.link.title ?? m.link.url, url: m.link.url, thumbnailUrl: m.link.thumbnailUrl }];
    }
    if (m.form) {
      return [{ id: `form-${index}`, kind: 'form', title: m.form.title ?? 'Форма', url: m.form.formUrl, thumbnailUrl: m.form.thumbnailUrl }];
    }
    return [{ id: `unknown-${index}`, kind: 'unknown', title: 'Вкладення' }];
  });
}

export function mapAssignment(
  work: GCourseWork,
  submission: GStudentSubmission | undefined,
  course: Course | undefined,
  profileId: ProfileId,
  fetchedAt: Instant,
  now: Date,
): Assignment {
  const { dueAt, dueIsAllDay } = mapDueAt(work);
  const id = namespacedId(SOURCE, profileId, work.id);

  return {
    id: asAssignmentId(id),
    dedupeKey: id,
    courseId: course?.id ?? asCourseId(namespacedId(SOURCE, profileId, work.courseId)),
    subjectKey: course?.subjectKey ?? 'unknown',
    title: work.title,
    description: work.description,
    dueAt,
    dueIsAllDay,
    assignedAt: work.creationTime,
    submission: mapSubmissionState(submission, dueAt, now),
    attachments: mapAttachments(work.materials),
    refs: [ref(profileId, work.id, fetchedAt, submission?.alternateLink ?? work.alternateLink)],
    provenance: {},
  };
}

export function mapAnnouncement(
  g: GAnnouncement,
  profileId: ProfileId,
  fetchedAt: Instant,
): Announcement {
  return {
    id: namespacedId(SOURCE, profileId, g.id),
    courseId: asCourseId(namespacedId(SOURCE, profileId, g.courseId)),
    text: g.text ?? '',
    postedAt: g.creationTime ?? fetchedAt,
    attachments: mapAttachments(g.materials),
    refs: [ref(profileId, g.id, fetchedAt, g.alternateLink)],
  };
}
