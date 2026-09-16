import type { SecretStore } from '@main/storage/secrets/SecretStore';
import type { SettingsStore } from '@main/storage/settingsStore';
import type { BrowserWindow } from 'electron';
import { GoogleClassroomProvider } from './google/GoogleClassroomProvider';
import { NzProvider } from './nz/NzProvider';
import { BrowserSessionTransport } from './nz/transport/BrowserSessionTransport';
import { SafeProvider } from './SafeProvider';
import type { SchoolDataProvider } from './SchoolDataProvider';

/**
 * Builds providers from the configured profiles. Everything is wrapped in
 * SafeProvider — no provider is ever used bare, so a failure anywhere degrades to an
 * empty list plus a health record instead of propagating.
 */
export function buildProviders(
  settings: SettingsStore,
  secrets: SecretStore,
  /** Surfaces the nz.ua login window when a sign-in is needed. */
  showLoginWindow: (win: BrowserWindow) => void = (win) => win.show(),
): SchoolDataProvider[] {
  return settings
    .get()
    .profiles.filter((p) => p.enabled)
    .flatMap((profile) => {
      switch (profile.source) {
        case 'google-classroom':
          return [
            new SafeProvider(
              new GoogleClassroomProvider(
                profile.id,
                profile.displayName,
                profile.secretKeyRef,
                secrets,
                settings,
              ),
            ),
          ];
        case 'nz':
          return [
            new SafeProvider(
              new NzProvider(
                profile.id,
                profile.displayName,
                new BrowserSessionTransport(profile.id, showLoginWindow),
              ),
            ),
          ];
        default:
          return [];
      }
    });
}
