import Store from 'electron-store';
import type { AppSettings, DeepPartial } from '@shared/domain/settings';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '@shared/domain/settings';

type Migration = (settings: Record<string, unknown>) => Record<string, unknown>;

/**
 * Forward-only settings migrations, indexed by the version they upgrade *from*.
 * Adding a field with a default needs no migration — deepMerge below supplies it.
 */
const MIGRATIONS: Record<number, Migration> = {};

/**
 * Settings hold no secrets — only a `secretKeyRef` pointing into the encrypted
 * secret store. See docs/ARCHITECTURE.md "Secrets".
 */
export class SettingsStore {
  private readonly store: Store<{ settings: AppSettings }>;

  constructor() {
    this.store = new Store<{ settings: AppSettings }>({
      name: 'settings',
      defaults: { settings: DEFAULT_SETTINGS },
    });
    this.migrate();
  }

  get(): AppSettings {
    return deepMerge(DEFAULT_SETTINGS, this.store.get('settings') ?? {});
  }

  patch(patch: DeepPartial<AppSettings>): AppSettings {
    const next = deepMerge(this.get(), patch);
    this.store.set('settings', next);
    return next;
  }

  reset(): AppSettings {
    this.store.set('settings', DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }

  private migrate(): void {
    const raw = this.store.get('settings') as unknown as Record<string, unknown> | undefined;
    if (!raw) return;

    let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
    if (version === SETTINGS_SCHEMA_VERSION) return;

    // A settings file from a *newer* build: leave it alone rather than mangling it.
    if (version > SETTINGS_SCHEMA_VERSION) return;

    let working = raw;
    while (version < SETTINGS_SCHEMA_VERSION) {
      const migration = MIGRATIONS[version];
      if (migration) working = migration(working);
      version += 1;
    }
    working.schemaVersion = SETTINGS_SCHEMA_VERSION;
    this.store.set('settings', working as unknown as AppSettings);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Merge a partial over defaults. Arrays replace wholesale; they are never merged. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  if (!isPlainObject(base)) return patch as T;

  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return out as T;
}
