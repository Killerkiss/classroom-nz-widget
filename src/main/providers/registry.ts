import type { SecretStore } from '@main/storage/secrets/SecretStore';
import type { SettingsStore } from '@main/storage/settingsStore';
import { GoogleClassroomProvider } from './google/GoogleClassroomProvider';
import { SafeProvider } from './SafeProvider';
import type { SchoolDataProvider } from './SchoolDataProvider';

/**
 * Builds providers from the configured profiles. Everything is wrapped in
 * SafeProvider — no provider is ever used bare, so a failure anywhere degrades to an
 * empty list plus a health record instead of propagating.
 */
export function buildProviders(settings: SettingsStore, secrets: SecretStore): SchoolDataProvider[] {
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
          // Lands in M4. Absent rather than stubbed, so the UI reports "no timetable
          // source" rather than an empty timetable that looks like a real answer.
          return [];
        default:
          return [];
      }
    });
}
