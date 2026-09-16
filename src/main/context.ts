import type { BrowserWindow } from 'electron';
import type { ProfileId } from '@shared/domain/ids';
import type { AppSettings } from '@shared/domain/settings';
import type { ProfileSummary } from '@shared/ipc/contract';
import type { AlertService } from '@main/alerts/AlertService';
import type { SchoolDataProvider } from '@main/providers/SchoolDataProvider';
import type { CacheStore } from '@main/storage/cacheStore';
import type { SecretStore } from '@main/storage/secrets/SecretStore';
import type { SettingsStore } from '@main/storage/settingsStore';
import type { SyncService } from '@main/sync/SyncService';

/**
 * The wiring root, passed to the IPC layer. Explicit rather than a set of module
 * globals so that services can be swapped in tests.
 */
export interface AppContext {
  settings: SettingsStore;
  cache: CacheStore;
  secrets: SecretStore;
  sync: SyncService;
  alerts: AlertService;

  providers(): SchoolDataProvider[];
  widget(): BrowserWindow | null;

  openSettings(): void;
  broadcastSnapshot(): void;
  onSettingsChanged(settings: AppSettings): void;

  addGoogleAccount(): Promise<ProfileSummary>;
  signOut(profileId: ProfileId): Promise<void>;
}
