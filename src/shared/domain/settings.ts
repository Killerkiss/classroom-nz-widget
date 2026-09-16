import type { ProfileId, SourceId } from './ids';
import type { CivilTime } from './models';

export const SETTINGS_SCHEMA_VERSION = 1;

/** Structural partial used by settings.patch(). Arrays replace wholesale. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** The school's timezone. All "which day" and "is it 18:00 yet" reasoning uses this. */
export const DEFAULT_SCHOOL_TIMEZONE = 'Europe/Kyiv';

export interface ProfileSettings {
  id: ProfileId;
  source: SourceId;
  displayName: string;
  /** Lookup key into the encrypted secret store. Never a secret itself. */
  secretKeyRef: string;
  enabled: boolean;
  /** nz.ua only: 'browser' logs in via a real window, 'password' auto-logs in. */
  nzAuthMode?: 'browser' | 'password';
  /** nz.ua only: which account role this is, since the two expose different data. */
  nzRole?: 'student' | 'parent';
}

export interface ScheduleViewSettings {
  timezone: string;
  /** Hour (school time) after which the widget shows tomorrow instead of today. */
  flipHour: number;
  /** On Friday evening, skip the weekend and show Monday. */
  skipWeekendsToNextSchoolDay: boolean;
  /** ISO weekdays that are school days: 1 = Monday … 7 = Sunday. */
  schoolDays: number[];
}

export interface AlertSettings {
  enabled: boolean;
  /** Alerts begin at this hour, school time. */
  startHour: number;
  repeatEveryMinutes: number;
  /** Start alerting this many days before the due date. */
  leadDays: number;
  /**
   * Hard cap per assignment per evening. Four is deliberate: persistent enough to
   * work, few enough that notifications don't get muted permanently.
   */
  maxAlertsPerEvening: number;
  quietHours: { start: CivilTime; end: CivilTime } | null;
  alertOnOverdue: boolean;
  alertOnDueToday: boolean;
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark';
  opacity: number;
  /** Let clicks pass through to the desktop behind the widget. */
  clickThrough: boolean;
  showSchedulePanel: boolean;
  showHomeworkPanel: boolean;
  compact: boolean;
}

export interface SyncSettings {
  refreshIntervalMinutes: number;
  syncOnResume: boolean;
}

export interface AppSettings {
  schemaVersion: number;
  locale: 'uk' | 'en';
  launchAtLogin: boolean;
  profiles: ProfileSettings[];
  schedule: ScheduleViewSettings;
  alerts: AlertSettings;
  appearance: AppearanceSettings;
  sync: SyncSettings;
  /** Per-subject Meet link overrides, keyed by subjectKey. Last resort in the resolver chain. */
  meetLinkOverrides: Record<string, string>;
  /** User-taught subject name aliases, so cross-system naming clashes need no release. */
  subjectAliases: Record<string, string>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  locale: 'uk',
  launchAtLogin: false,
  profiles: [],
  schedule: {
    timezone: DEFAULT_SCHOOL_TIMEZONE,
    flipHour: 18,
    skipWeekendsToNextSchoolDay: true,
    schoolDays: [1, 2, 3, 4, 5],
  },
  alerts: {
    enabled: true,
    startHour: 18,
    repeatEveryMinutes: 60,
    leadDays: 1,
    maxAlertsPerEvening: 4,
    quietHours: { start: '22:00', end: '07:00' },
    alertOnOverdue: true,
    alertOnDueToday: true,
  },
  appearance: {
    theme: 'system',
    opacity: 0.95,
    clickThrough: false,
    showSchedulePanel: true,
    showHomeworkPanel: true,
    compact: false,
  },
  sync: {
    refreshIntervalMinutes: 15,
    syncOnResume: true,
  },
  meetLinkOverrides: {},
  subjectAliases: {},
};
