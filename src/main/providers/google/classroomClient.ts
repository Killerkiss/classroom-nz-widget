import { ProviderError } from '@shared/domain/errors';
import type { GAnnouncement, GCourse, GCourseWork, GStudentSubmission } from './types';

const BASE = 'https://classroom.googleapis.com/v1';

export type AccessTokenProvider = () => Promise<string>;

/**
 * A thin Classroom REST client. Deliberately hand-rolled rather than pulling in
 * `googleapis`, which would add tens of megabytes for the handful of read-only
 * endpoints this app touches.
 */
export class ClassroomClient {
  constructor(private readonly getAccessToken: AccessTokenProvider) {}

  async listCourses(signal: AbortSignal): Promise<GCourse[]> {
    return this.paged<GCourse>('/courses', { studentId: 'me', courseStates: 'ACTIVE' }, 'courses', signal);
  }

  async listCourseWork(courseId: string, signal: AbortSignal): Promise<GCourseWork[]> {
    return this.paged<GCourseWork>(
      `/courses/${encodeURIComponent(courseId)}/courseWork`,
      { courseWorkStates: 'PUBLISHED' },
      'courseWork',
      signal,
    );
  }

  /** `-` as the courseWork id returns submissions across all coursework in one call. */
  async listSubmissions(courseId: string, signal: AbortSignal): Promise<GStudentSubmission[]> {
    return this.paged<GStudentSubmission>(
      `/courses/${encodeURIComponent(courseId)}/courseWork/-/studentSubmissions`,
      { userId: 'me' },
      'studentSubmissions',
      signal,
    );
  }

  async listAnnouncements(courseId: string, signal: AbortSignal): Promise<GAnnouncement[]> {
    return this.paged<GAnnouncement>(
      `/courses/${encodeURIComponent(courseId)}/announcements`,
      { announcementStates: 'PUBLISHED' },
      'announcements',
      signal,
    );
  }

  private async paged<T>(
    path: string,
    params: Record<string, string>,
    key: string,
    signal: AbortSignal,
  ): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(BASE + path);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const body = await this.request<Record<string, unknown>>(url, signal);
      const items = body[key];
      if (Array.isArray(items)) out.push(...(items as T[]));
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
    } while (pageToken);

    return out;
  }

  private async request<T>(url: URL, signal: AbortSignal): Promise<T> {
    const token = await this.getAccessToken();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
      });
    } catch (err) {
      throw new ProviderError(
        { kind: 'NETWORK', source: 'google-classroom', message: (err as Error).message },
        { cause: err },
      );
    }

    if (response.ok) return (await response.json()) as T;

    const detail = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError({
        kind: 'AUTH',
        source: 'google-classroom',
        status: response.status,
        message: `Google rejected the request (${response.status}). Sign in again.`,
      });
    }
    if (response.status === 429) {
      throw new ProviderError({
        kind: 'RATE_LIMIT',
        source: 'google-classroom',
        status: 429,
        message: 'Rate limited by Google.',
      });
    }
    throw new ProviderError({
      kind: 'UNKNOWN',
      source: 'google-classroom',
      status: response.status,
      message: `Classroom request failed (${response.status}): ${detail.slice(0, 200)}`,
    });
  }
}
