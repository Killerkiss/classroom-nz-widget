/** The subset of the Classroom REST shapes this app reads. */

export interface GCourse {
  id: string;
  name: string;
  section?: string;
  room?: string;
  descriptionHeading?: string;
  courseState?: string;
  alternateLink?: string;
  calendarId?: string;
  ownerId?: string;
}

export interface GDate {
  year: number;
  month: number;
  day: number;
}

export interface GTimeOfDay {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export interface GMaterial {
  driveFile?: { driveFile?: { id: string; title?: string; alternateLink?: string; thumbnailUrl?: string } };
  youtubeVideo?: { id: string; title?: string; alternateLink?: string; thumbnailUrl?: string };
  link?: { url: string; title?: string; thumbnailUrl?: string };
  form?: { formUrl: string; title?: string; thumbnailUrl?: string };
}

export interface GCourseWork {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  materials?: GMaterial[];
  state?: string;
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
  /** Due date and time are UTC, and dueTime is absent for an all-day due date. */
  dueDate?: GDate;
  dueTime?: GTimeOfDay;
  maxPoints?: number;
  workType?: string;
}

export interface GStudentSubmission {
  id: string;
  courseId: string;
  courseWorkId: string;
  state?: 'SUBMISSION_STATE_UNSPECIFIED' | 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';
  late?: boolean;
  draftGrade?: number;
  assignedGrade?: number;
  alternateLink?: string;
  updateTime?: string;
}

export interface GAnnouncement {
  id: string;
  courseId: string;
  text?: string;
  materials?: GMaterial[];
  creationTime?: string;
  updateTime?: string;
  alternateLink?: string;
}
