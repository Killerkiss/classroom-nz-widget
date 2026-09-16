import type { SecretBackendInfo } from '@shared/ipc/contract';

export interface SecretStore {
  readonly info: SecretBackendInfo;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
  /**
   * Whether a long-lived credential (an nz.ua password) may be written here.
   * False when storage is not genuinely encrypted at rest.
   */
  canStoreLongLivedCredential(): boolean;
}
