import type { ProfileId } from '@shared/domain/ids';
import type { Announcement, Assignment, Course, Lesson } from '@shared/domain/models';
import type { ConferenceSlot } from '@shared/core/meet/conferenceSlots';
import { toConferenceSlot } from '@shared/core/meet/conferenceSlots';
import type { AuthStatus, Capability, ProviderHealth } from '@shared/ipc/contract';
import { ProviderError } from '@shared/domain/errors';
import { log } from '@main/logging';
import type { SecretStore } from '@main/storage/secrets/SecretStore';
import type { SettingsStore } from '@main/storage/settingsStore';
import type { DateRange, FetchContext, SchoolDataProvider } from '../SchoolDataProvider';
import { CalendarClient } from './calendarClient';
import { ClassroomClient } from './classroomClient';
import { mapAnnouncement, mapAssignment, mapCourse } from './mappers';
import type { OAuthClientConfig, TokenSet } from './oauth';
import { loadClientConfig, refreshAccessToken, runAuthorizationFlow } from './oauth';

const SOURCE = 'google-classroom' as const;

/**
 * Classroom exposes no timetable — no periods, no times, no Meet link on a course.
 * So `timetable` is absent from its capabilities and lessons come from nz.ua.
 */
const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'courses',
  'homework',
  'submissions',
  'announcements',
  'attachments',
  // Not from Classroom itself — Course has no Meet field — but from Calendar events.
  'meetLinks',
]);

/** Guard against an account with dozens of subscribed calendars. */
const MAX_CALENDARS = 12;

/** Refresh a little early so a request never races the expiry. */
const EXPIRY_MARGIN_MS = 60_000;

export class GoogleClassroomProvider implements SchoolDataProvider {
  readonly source = SOURCE;
  private tokens: TokenSet | null = null;
  private config: OAuthClientConfig | null = null;
  private currentHealth: ProviderHealth;
  private readonly client: ClassroomClient;
  private readonly calendar: CalendarClient;

  constructor(
    readonly profileId: ProfileId,
    readonly displayName: string,
    private readonly secretKeyRef: string,
    private readonly secrets: SecretStore,
    private readonly settings: SettingsStore,
  ) {
    this.currentHealth = {
      source: SOURCE,
      profileId,
      status: 'ok',
      capabilities: {},
    };
    this.client = new ClassroomClient(() => this.accessToken());
    this.calendar = new CalendarClient(() => this.accessToken());
  }

  capabilities(): ReadonlySet<Capability> {
    return CAPABILITIES;
  }

  health(): ProviderHealth {
    return this.currentHealth;
  }

  async authStatus(): Promise<AuthStatus> {
    const refreshToken = await this.secrets.get(this.secretKeyRef);
    if (!refreshToken) return 'unauthenticated';
    try {
      await this.accessToken();
      return 'authenticated';
    } catch {
      return 'expired';
    }
  }

  async authenticate(): Promise<void> {
    const config = this.clientConfig();
    const tokens = await runAuthorizationFlow(config);
    if (!tokens.refreshToken) {
      throw new ProviderError({
        kind: 'AUTH',
        source: SOURCE,
        message: 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and sign in again.',
      });
    }
    await this.secrets.set(this.secretKeyRef, tokens.refreshToken);
    this.tokens = tokens;
  }

  async signOut(): Promise<void> {
    await this.secrets.delete(this.secretKeyRef);
    this.tokens = null;
  }

  async listCourses(ctx: FetchContext): Promise<Course[]> {
    const aliases = this.settings.get().subjectAliases;
    const fetchedAt = ctx.now.toISOString();
    const courses = await this.client.listCourses(ctx.signal);
    return courses.map((c) => mapCourse(c, this.profileId, fetchedAt, aliases));
  }

  /** Classroom has no timetable. Always empty; the capability set says so too. */
  async listLessons(_range: DateRange, _ctx: FetchContext): Promise<Lesson[]> {
    return [];
  }

  async listAssignments(_range: DateRange, ctx: FetchContext): Promise<Assignment[]> {
    const courses = await this.listCourses(ctx);
    const byId = new Map(courses.map((c) => [c.refs[0]?.nativeId as string, c]));
    const fetchedAt = ctx.now.toISOString();

    // One course failing must not discard the others' homework, so each course is
    // settled independently and its failure logged with enough context to identify it.
    const settled = await Promise.allSettled(
      courses.map(async (course) => {
        const nativeId = course.refs[0]?.nativeId as string;
        const [work, submissions] = await Promise.allSettled([
          this.client.listCourseWork(nativeId, ctx.signal),
          this.client.listSubmissions(nativeId, ctx.signal),
        ]).then((r) => [
          r[0].status === 'fulfilled' ? r[0].value : [],
          r[1].status === 'fulfilled' ? r[1].value : [],
        ] as const);

        const submissionByWorkId = new Map(submissions.map((s) => [s.courseWorkId, s]));

        return work.map((w) =>
          mapAssignment(w, submissionByWorkId.get(w.id), byId.get(nativeId), this.profileId, fetchedAt, ctx.now),
        );
      }),
    );

    const assignments: Assignment[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') {
        log.warn(`[google-classroom] coursework failed for course "${courses[i]?.name}": ${String(outcome.reason)}`);
        return;
      }
      assignments.push(...outcome.value);
    });

    return assignments;
  }

  async listAnnouncements(_range: DateRange, ctx: FetchContext): Promise<Announcement[]> {
    const courses = await this.listCourses(ctx);
    const fetchedAt = ctx.now.toISOString();

    const settled = await Promise.allSettled(
      courses.map((c) => this.client.listAnnouncements(c.refs[0]?.nativeId as string, ctx.signal)),
    );

    const out: Announcement[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') {
        log.warn(`[google-classroom] announcements failed for course "${courses[i]?.name}": ${String(outcome.reason)}`);
        return;
      }
      out.push(...outcome.value.map((a) => mapAnnouncement(a, this.profileId, fetchedAt)));
    });
    return out;
  }

  /**
   * Conferencing links come from Calendar, because Classroom's Course resource has
   * no Meet link field at all. Every calendar is fetched independently so one
   * inaccessible calendar cannot cost us the others' links.
   */
  async listConferenceSlots(range: DateRange, ctx: FetchContext): Promise<ConferenceSlot[]> {
    const aliases = this.settings.get().subjectAliases;
    const timeMin = new Date(`${range.from}T00:00:00Z`).toISOString();
    const timeMax = new Date(`${range.to}T23:59:59Z`).toISOString();

    const calendars = (await this.calendar.listCalendars(ctx.signal)).slice(0, MAX_CALENDARS);

    const settled = await Promise.allSettled(
      calendars.map((c) => this.calendar.listEvents(c.id, timeMin, timeMax, ctx.signal)),
    );

    const slots: ConferenceSlot[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') {
        log.warn(
          `[google-classroom] calendar "${calendars[i]?.summary ?? calendars[i]?.id}" failed: ${String(outcome.reason)}`,
        );
        return;
      }
      for (const event of outcome.value) {
        const slot = toConferenceSlot(event, aliases);
        if (slot) slots.push(slot);
      }
    });

    return slots;
  }

  private clientConfig(): OAuthClientConfig {
    this.config ??= loadClientConfig();
    return this.config;
  }

  private async accessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }

    const refreshToken = this.tokens?.refreshToken ?? (await this.secrets.get(this.secretKeyRef));
    if (!refreshToken) {
      throw new ProviderError({ kind: 'AUTH', source: SOURCE, message: 'Not signed in to Google.' });
    }

    this.tokens = await refreshAccessToken(this.clientConfig(), refreshToken);
    if (this.tokens.refreshToken && this.tokens.refreshToken !== refreshToken) {
      await this.secrets.set(this.secretKeyRef, this.tokens.refreshToken);
    }
    return this.tokens.accessToken;
  }
}
