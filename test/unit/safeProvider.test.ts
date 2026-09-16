import { describe, expect, it, vi } from 'vitest';
import { SafeProvider } from '@main/providers/SafeProvider';
import type { DateRange, FetchContext, SchoolDataProvider } from '@main/providers/SchoolDataProvider';
import type { Capability, ProviderHealth } from '@shared/ipc/contract';
import { ProviderError } from '@shared/domain/errors';
import { asProfileId } from '@shared/domain/ids';

vi.mock('@main/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const profileId = asProfileId('p1');
const range: DateRange = { from: '2026-09-01', to: '2026-09-30' };
const ctx: FetchContext = { signal: new AbortController().signal, now: new Date('2026-09-16T12:00:00Z') };

function fake(over: Partial<SchoolDataProvider> & { caps?: Capability[] } = {}): SchoolDataProvider {
  const health: ProviderHealth = { source: 'nz', profileId, status: 'ok', capabilities: {} };
  return {
    source: 'nz',
    profileId,
    displayName: 'nz.ua',
    capabilities: () => new Set(over.caps ?? (['courses', 'timetable', 'homework', 'announcements'] as Capability[])),
    health: () => health,
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

describe('SafeProvider — a failing source must be a non-event', () => {
  it('returns an empty list instead of throwing', async () => {
    const provider = new SafeProvider(
      fake({
        listAssignments: async () => {
          throw new Error('nz.ua exploded');
        },
      }),
    );

    await expect(provider.listAssignments(range, ctx)).resolves.toEqual([]);
  });

  it('records the failure in health so the UI can explain it', async () => {
    const provider = new SafeProvider(
      fake({
        listAssignments: async () => {
          throw new ProviderError({ kind: 'WAF', source: 'nz', message: 'blocked' });
        },
      }),
    );

    await provider.listAssignments(range, ctx);
    const health = provider.health();
    expect(health.status).toBe('blocked');
    expect(health.lastError?.kind).toBe('WAF');
  });

  it('maps an auth failure to auth_required rather than a generic error', async () => {
    const provider = new SafeProvider(
      fake({
        listCourses: async () => {
          throw new ProviderError({ kind: 'AUTH', source: 'nz', message: 'expired' });
        },
      }),
    );

    await provider.listCourses(ctx);
    expect(provider.health().status).toBe('auth_required');
  });

  it('marks a capability broken when the upstream shape changed', async () => {
    const provider = new SafeProvider(
      fake({
        listLessons: async () => {
          throw new ProviderError({ kind: 'SCHEMA_DRIFT', source: 'nz', message: 'renamed field' });
        },
      }),
    );

    await provider.listLessons(range, ctx);
    expect(provider.health().capabilities.timetable).toBe('broken');
  });

  it('does not call an unsupported capability, and reports it as such', async () => {
    const listLessons = vi.fn();
    const provider = new SafeProvider(fake({ caps: ['homework'], listLessons }));

    await expect(provider.listLessons(range, ctx)).resolves.toEqual([]);
    expect(listLessons).not.toHaveBeenCalled();
    expect(provider.health().capabilities.timetable).toBe('unsupported');
  });

  it('one failing capability does not poison the others', async () => {
    const provider = new SafeProvider(
      fake({
        listLessons: async () => {
          throw new Error('timetable down');
        },
        listAssignments: async () => [{ id: 'a1' } as never],
      }),
    );

    await provider.listLessons(range, ctx);
    await expect(provider.listAssignments(range, ctx)).resolves.toHaveLength(1);
    expect(provider.health().status).toBe('ok');
  });

  it('reports unauthenticated rather than throwing when the auth check fails', async () => {
    const provider = new SafeProvider(
      fake({
        authStatus: async () => {
          throw new Error('network down');
        },
      }),
    );
    await expect(provider.authStatus()).resolves.toBe('unauthenticated');
  });

  it('lets an explicit sign-in surface its own error', async () => {
    const provider = new SafeProvider(
      fake({
        authenticate: async () => {
          throw new Error('user cancelled');
        },
      }),
    );
    // A user-initiated action must report failure, not fail silently.
    await expect(provider.authenticate()).rejects.toThrow('user cancelled');
  });
});
