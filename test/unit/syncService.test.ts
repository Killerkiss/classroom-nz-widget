import { describe, expect, it, vi } from 'vitest';
import { SyncService } from '@main/sync/SyncService';
import type { SchoolDataProvider } from '@main/providers/SchoolDataProvider';
import type { CachedData } from '@main/storage/cacheStore';
import type { Snapshot } from '@shared/ipc/contract';
import { DEFAULT_SETTINGS } from '@shared/domain/settings';
import { asCourseId, asProfileId } from '@shared/domain/ids';
import type { Course } from '@shared/domain/models';

vi.mock('@main/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const NOW = new Date('2026-09-16T09:00:00Z');
const clock = { now: () => NOW };

function makeCache() {
  let data: CachedData = {
    schemaVersion: 1,
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
  return {
    read: () => data,
    update: (patch: Partial<CachedData>) => {
      data = { ...data, ...patch };
      return data;
    },
    getAlertStates: () => data.alertStates,
    putAlertStates: () => {},
    setLocallyDone: () => {},
    getMergeOverrides: () => data.mergeOverrides,
    putMergeOverride: () => {},
    schemaVersion: 2,
  } as unknown as ConstructorParameters<typeof SyncService>[1];
}

const settingsStore = {
  get: () => DEFAULT_SETTINGS,
  patch: (p: unknown) => ({ ...DEFAULT_SETTINGS, ...(p as object) }),
  reset: () => DEFAULT_SETTINGS,
} as unknown as ConstructorParameters<typeof SyncService>[0];

function course(name: string): Course {
  return {
    id: asCourseId(`c-${name}`),
    name,
    subjectKey: name,
    refs: [],
  };
}

function provider(over: Partial<SchoolDataProvider>): SchoolDataProvider {
  return {
    source: 'google-classroom',
    profileId: asProfileId('p'),
    displayName: 'test',
    capabilities: () => new Set(),
    health: () => ({ source: 'google-classroom', profileId: asProfileId('p'), status: 'ok', capabilities: {} }),
    authStatus: async () => 'authenticated',
    authenticate: async () => {},
    signOut: async () => {},
    listCourses: async () => [],
    listLessons: async () => [],
    listAssignments: async () => [],
    listAnnouncements: async () => [],
    ...over,
  } as SchoolDataProvider;
}

describe('SyncService', () => {
  it('keeps a healthy source’s data when another source throws', async () => {
    const good = provider({ displayName: 'good', listCourses: async () => [course('algebra')] });
    const bad = provider({
      displayName: 'bad',
      listCourses: async () => {
        throw new Error('down');
      },
    });

    let snapshot: Snapshot | null = null;
    const sync = new SyncService(settingsStore, makeCache(), clock, () => [good, bad], (s) => (snapshot = s));

    await sync.refresh();

    // Half a schedule beats none: the failure must not discard what succeeded.
    expect(snapshot!.courses.map((c) => c.name)).toEqual(['algebra']);
  });

  it('emits a snapshot even with no providers configured', async () => {
    let snapshot: Snapshot | null = null;
    const sync = new SyncService(settingsStore, makeCache(), clock, () => [], (s) => (snapshot = s));

    await sync.refresh();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.courses).toEqual([]);
  });

  it('marks a never-synced cache as stale', () => {
    const sync = new SyncService(settingsStore, makeCache(), clock, () => [], () => {});
    expect(sync.snapshot().stale).toBe(true);
  });

  it('is fresh immediately after a refresh', async () => {
    const sync = new SyncService(settingsStore, makeCache(), clock, () => [provider({})], () => {});
    await sync.refresh();
    expect(sync.snapshot().stale).toBe(false);
  });

  it('includes the schedule selection so the widget knows which day to show', () => {
    const sync = new SyncService(settingsStore, makeCache(), clock, () => [], () => {});
    // 09:00Z = 12:00 Kyiv, before the 18:00 flip.
    expect(sync.snapshot().selection).toMatchObject({ date: '2026-09-16', label: 'today' });
  });

  it('collects health from every provider, failed ones included', async () => {
    const good = provider({ displayName: 'good' });
    const bad = provider({
      displayName: 'bad',
      listAssignments: async () => {
        throw new Error('nope');
      },
    });

    let snapshot: Snapshot | null = null;
    const sync = new SyncService(settingsStore, makeCache(), clock, () => [good, bad], (s) => (snapshot = s));
    await sync.refresh();

    expect(snapshot!.health).toHaveLength(2);
  });
});
