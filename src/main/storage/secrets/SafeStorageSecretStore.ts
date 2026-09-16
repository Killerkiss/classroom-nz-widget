import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { SecretBackendInfo } from '@shared/ipc/contract';
import type { SecretStore } from './SecretStore';

/**
 * Encrypted secret storage backed by the OS keyring via Electron's safeStorage.
 *
 * Deliberately not keytar: it is archived, needs a native rebuild per Electron ABI,
 * and pulls libsecret as a runtime dependency — which is the exact fragility we are
 * trying to avoid on Linux.
 */
export class SafeStorageSecretStore implements SecretStore {
  readonly info: SecretBackendInfo;
  private readonly file: string;
  private cache: Record<string, string> | null = null;

  constructor(file = join(app.getPath('userData'), 'secrets.json')) {
    this.file = file;
    this.info = detectBackend();
  }

  canStoreLongLivedCredential(): boolean {
    return this.info.isEncryptedAtRest;
  }

  async get(key: string): Promise<string | null> {
    const blob = this.read()[key];
    if (!blob) return null;
    try {
      return safeStorage.decryptString(Buffer.from(blob, 'base64'));
    } catch {
      // Keyring changed or the file moved between machines: treat as absent so the
      // user is asked to sign in again rather than hitting an opaque crash.
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const all = this.read();
    all[key] = safeStorage.encryptString(value).toString('base64');
    this.write(all);
  }

  async delete(key: string): Promise<void> {
    const all = this.read();
    delete all[key];
    this.write(all);
  }

  async listKeys(): Promise<string[]> {
    return Object.keys(this.read());
  }

  private read(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.file)) {
      this.cache = {};
      return this.cache;
    }
    try {
      this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private write(all: Record<string, string>): void {
    this.cache = all;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(all), { mode: 0o600 });
  }
}

/**
 * Work out what safeStorage is actually doing, which matters on Linux.
 *
 * `basic_text` is the trap: Electron "encrypts" with a key that ships in its own
 * source, so it is obfuscation, not encryption. On a normal Mint desktop this never
 * happens, but on a headless or autologin session it silently would — so it is
 * detected and surfaced rather than trusted.
 */
export function detectBackend(): SecretBackendInfo {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      backend: 'unavailable',
      isPersistent: false,
      isEncryptedAtRest: false,
      warning:
        'No secure storage is available. Credentials will be kept in memory only and cleared when the app quits.',
    };
  }

  if (process.platform !== 'linux') {
    return {
      backend: process.platform === 'darwin' ? 'keychain' : 'dpapi',
      isPersistent: true,
      isEncryptedAtRest: true,
    };
  }

  const backend = safeStorage.getSelectedStorageBackend();
  if (backend === 'basic_text') {
    return {
      backend,
      isPersistent: true,
      isEncryptedAtRest: false,
      warning:
        'No system keyring was found, so secrets are only obfuscated, not encrypted. ' +
        'Install and unlock gnome-keyring (or KWallet) to store credentials securely.',
    };
  }

  return { backend, isPersistent: true, isEncryptedAtRest: true };
}
