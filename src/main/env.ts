import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Load Google OAuth credentials from a .env file.
 *
 * In development that is the project root; in a packaged app the project root is
 * read-only (and inside an AppImage, not even a real directory), so userData is the
 * only sensible place for a user to drop credentials.
 *
 * Deliberately not bundled at build time: that would bake one family's client id
 * into every build and make the public repo's artifacts carry a credential.
 */
export function loadEnvFile(): string | null {
  const candidates = app.isPackaged
    ? [join(app.getPath('userData'), '.env')]
    : [join(process.cwd(), '.env'), join(app.getAppPath(), '.env')];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
      return path;
    } catch {
      // A malformed .env should not stop the app booting — the account simply
      // stays unconfigured and Settings explains why.
    }
  }
  return null;
}

/** Where a user should put their credentials, for use in error messages. */
export function envFileLocation(): string {
  return app.isPackaged ? join(app.getPath('userData'), '.env') : join(process.cwd(), '.env');
}
