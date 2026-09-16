/// <reference types="vite/client" />
import type { IpcApi } from '@shared/ipc/contract';

declare global {
  interface Window {
    /** The only privileged surface available to the renderer. See src/preload/index.ts. */
    readonly api: IpcApi;
  }
}

export {};
