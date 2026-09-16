import type { AssignmentId, ProfileId, SourceId } from '../domain/ids';
import type { Announcement, Assignment, Course, Instant, Lesson } from '../domain/models';
import type { AppSettings, DeepPartial } from '../domain/settings';
import type { ProviderErrorInfo } from '../domain/errors';
import type { ScheduleSelection } from '../core/scheduleView';

export type AuthStatus = 'authenticated' | 'expired' | 'unauthenticated';

export type Capability =
  | 'courses' | 'timetable' | 'homework' | 'submissions'
  | 'grades' | 'announcements' | 'attachments' | 'meetLinks';

export interface ProviderHealth {
  source: SourceId;
  profileId: ProfileId;
  status: 'ok' | 'degraded' | 'auth_required' | 'blocked' | 'down';
  capabilities: Partial<Record<Capability, 'ok' | 'unsupported' | 'broken'>>;
  lastOkAt?: Instant;
  lastError?: ProviderErrorInfo;
  transport?: 'http' | 'browser-session' | 'fixture';
}

/** Everything the widget needs for one paint. Served from cache first, then refreshed. */
export interface Snapshot {
  generatedAt: Instant;
  selection: ScheduleSelection;
  lessons: Lesson[];
  assignments: Assignment[];
  courses: Course[];
  health: ProviderHealth[];
  /** True when the data is older than the app considers fresh. */
  stale: boolean;
}

export interface AssignmentDetail {
  assignment: Assignment;
  course?: Course;
  announcements: Announcement[];
}

export interface SecretBackendInfo {
  backend: string;
  isPersistent: boolean;
  /**
   * False on Linux when Electron falls back to `basic_text`, which uses a hardcoded
   * key. The UI must warn rather than silently pretend secrets are protected.
   */
  isEncryptedAtRest: boolean;
  warning?: string;
}

export interface ProfileSummary {
  id: ProfileId;
  source: SourceId;
  displayName: string;
  status: AuthStatus;
}

export interface DiagnosticsReport {
  app: string;
  electron: string;
  platform: string;
  secretBackend: SecretBackendInfo;
  health: ProviderHealth[];
  settingsSchemaVersion: number;
  cacheSchemaVersion: number;
}

/**
 * The full main<->renderer surface. The preload bridge is derived from this type,
 * so the two cannot drift apart.
 */
export interface IpcApi {
  data: {
    getSnapshot(): Promise<Snapshot>;
    refresh(opts?: { force?: boolean }): Promise<void>;
    getAssignment(id: AssignmentId): Promise<AssignmentDetail | null>;
  };
  alerts: {
    snooze(assignmentId: AssignmentId, minutes: number): Promise<void>;
    dismiss(assignmentId: AssignmentId): Promise<void>;
    /** Local-only: silences alerts without needing an OAuth write scope. */
    markDone(assignmentId: AssignmentId, done: boolean): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    patch(patch: DeepPartial<AppSettings>): Promise<AppSettings>;
    reset(): Promise<AppSettings>;
  };
  auth: {
    status(): Promise<ProfileSummary[]>;
    addGoogleAccount(): Promise<ProfileSummary>;
    /** Opens a real nz.ua login window; no password ever passes through this app. */
    addNzAccount(): Promise<ProfileSummary>;
    signOut(profileId: ProfileId): Promise<void>;
    secretBackend(): Promise<SecretBackendInfo>;
  };
  window: {
    openSettings(section?: string): Promise<void>;
    hideWidget(): Promise<void>;
    setClickThrough(enabled: boolean): Promise<void>;
  };
  system: {
    /** Rejects anything that is not https: — see docs/ARCHITECTURE.md "IPC". */
    openExternal(url: string): Promise<void>;
    getVersion(): Promise<{ app: string; electron: string; platform: string }>;
    getDiagnostics(): Promise<DiagnosticsReport>;
    /**
     * Records which data endpoints the real nz.ua site calls, so the integration
     * can be built against observed paths instead of guesses. Returns a redacted
     * report: paths and parameter names only.
     */
    runNzDiscovery(profileId: ProfileId, seconds: number): Promise<string>;
  };
  /** Subscribe to pushes from main. Returns an unsubscribe function. */
  on<E extends MainEvent['type']>(
    type: E,
    handler: (event: Extract<MainEvent, { type: E }>) => void,
  ): () => void;
}

import type { MainEvent } from './events';
export type { MainEvent };
export type { DeepPartial };

/** Namespaces that carry request/response methods, used to build the bridge. */
export const IPC_NAMESPACES = ['data', 'alerts', 'settings', 'auth', 'window', 'system'] as const;
export type IpcNamespace = (typeof IPC_NAMESPACES)[number];

/**
 * Runtime method names, needed because the preload bridge must expose plain
 * objects — contextBridge cannot clone a Proxy, so the surface cannot be derived
 * from the type alone.
 *
 * The `satisfies` clause rejects a name that is not a real method, and
 * AllMethodsListed below fails to compile if a method is ever left out, so this
 * list cannot drift from IpcApi in either direction.
 */
export const IPC_METHODS = {
  data: ['getSnapshot', 'refresh', 'getAssignment'],
  alerts: ['snooze', 'dismiss', 'markDone'],
  settings: ['get', 'patch', 'reset'],
  auth: ['status', 'addGoogleAccount', 'addNzAccount', 'signOut', 'secretBackend'],
  window: ['openSettings', 'hideWidget', 'setClickThrough'],
  system: ['openExternal', 'getVersion', 'getDiagnostics', 'runNzDiscovery'],
} as const satisfies { [K in IpcNamespace]: ReadonlyArray<keyof IpcApi[K]> };

/** Compile-time guard: every method in every namespace must appear above. */
type MissingMethods = {
  [K in IpcNamespace]: Exclude<keyof IpcApi[K], (typeof IPC_METHODS)[K][number]>;
}[IpcNamespace];
type AllMethodsListed = MissingMethods extends never ? true : ['IPC_METHODS is missing:', MissingMethods];

// Must be a value assignment: a bare type alias would never report an error.
// Exported so noUnusedLocals does not strip the very check we rely on.
export const _assertAllMethodsListed: AllMethodsListed = true;

/** Single channel for main -> renderer pushes, demultiplexed by event type. */
export const MAIN_EVENT_CHANNEL = 'main:event';

export const channelFor = (ns: IpcNamespace, method: string): string => `${ns}:${method}`;
