import type { SecretBackendInfo } from '@shared/ipc/contract';
import type { SecretStore } from './SecretStore';

/** In-memory fallback. Nothing survives quitting, which is the point. */
export class SessionOnlySecretStore implements SecretStore {
  readonly info: SecretBackendInfo = {
    backend: 'session-only',
    isPersistent: false,
    isEncryptedAtRest: false,
    warning: 'Credentials are kept in memory only and will be cleared when the app quits.',
  };

  private readonly values = new Map<string, string>();

  canStoreLongLivedCredential(): boolean {
    return false;
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async listKeys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}
