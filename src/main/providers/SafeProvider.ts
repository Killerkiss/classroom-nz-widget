import type { NativeId, ProfileId, SourceId } from '@shared/domain/ids';
import type { Announcement, Assignment, Course, Lesson } from '@shared/domain/models';
import type { ConferenceSlot } from '@shared/core/meet/conferenceSlots';
import type { AuthStatus, Capability, ProviderHealth } from '@shared/ipc/contract';
import { classifyError } from '@shared/domain/errors';
import { log } from '@main/logging';
import type { DateRange, FetchContext, SchoolDataProvider } from './SchoolDataProvider';

/**
 * Wraps a provider so it can never throw into the rest of the app.
 *
 * This single decorator is what makes "nz.ua broke" a non-event: a failing source
 * degrades to an empty list plus a health record, and the other source's data still
 * reaches the widget. Every provider goes through here — none are used bare.
 */
export class SafeProvider implements SchoolDataProvider {
  private lastHealth: ProviderHealth;

  constructor(private readonly inner: SchoolDataProvider) {
    this.lastHealth = inner.health();
  }

  get source(): SourceId {
    return this.inner.source;
  }
  get profileId(): ProfileId {
    return this.inner.profileId;
  }
  get displayName(): string {
    return this.inner.displayName;
  }

  capabilities(): ReadonlySet<Capability> {
    return this.inner.capabilities();
  }

  health(): ProviderHealth {
    return this.lastHealth;
  }

  async authStatus(): Promise<AuthStatus> {
    try {
      return await this.inner.authStatus();
    } catch {
      return 'unauthenticated';
    }
  }

  authenticate(): Promise<void> {
    // Deliberately not guarded: an explicit user action should surface its error.
    return this.inner.authenticate();
  }

  signOut(): Promise<void> {
    return this.inner.signOut();
  }

  listCourses(ctx: FetchContext): Promise<Course[]> {
    return this.guard('courses', () => this.inner.listCourses(ctx));
  }

  listLessons(range: DateRange, ctx: FetchContext): Promise<Lesson[]> {
    return this.guard('timetable', () => this.inner.listLessons(range, ctx));
  }

  listAssignments(range: DateRange, ctx: FetchContext): Promise<Assignment[]> {
    return this.guard('homework', () => this.inner.listAssignments(range, ctx));
  }

  listAnnouncements(range: DateRange, ctx: FetchContext): Promise<Announcement[]> {
    return this.guard('announcements', () => this.inner.listAnnouncements(range, ctx));
  }

  listConferenceSlots(range: DateRange, ctx: FetchContext): Promise<ConferenceSlot[]> {
    if (!this.inner.listConferenceSlots) return Promise.resolve([]);
    return this.guard('meetLinks', () => this.inner.listConferenceSlots!(range, ctx));
  }

  markDone(assignmentId: NativeId): Promise<void> {
    return this.inner.markDone?.(assignmentId) ?? Promise.resolve();
  }

  private async guard<T>(capability: Capability, fn: () => Promise<T[]>): Promise<T[]> {
    if (!this.capabilities().has(capability)) {
      this.recordCapability(capability, 'unsupported');
      return [];
    }

    try {
      const result = await fn();
      this.lastHealth = {
        ...this.inner.health(),
        status: 'ok',
        lastOkAt: new Date().toISOString(),
        capabilities: { ...this.lastHealth.capabilities, [capability]: 'ok' },
      };
      return result;
    } catch (err) {
      const error = classifyError(err, this.source);
      log.warn(`[${this.source}] ${capability} failed: ${error.kind} — ${error.message}`);

      this.lastHealth = {
        ...this.lastHealth,
        status: error.kind === 'AUTH' ? 'auth_required' : error.kind === 'WAF' ? 'blocked' : 'degraded',
        lastError: error.toInfo(new Date().toISOString()),
        capabilities: {
          ...this.lastHealth.capabilities,
          [capability]: error.kind === 'SCHEMA_DRIFT' ? 'broken' : this.lastHealth.capabilities[capability] ?? 'ok',
        },
      };
      return [];
    }
  }

  private recordCapability(capability: Capability, value: 'ok' | 'unsupported' | 'broken'): void {
    this.lastHealth = {
      ...this.lastHealth,
      capabilities: { ...this.lastHealth.capabilities, [capability]: value },
    };
  }
}
