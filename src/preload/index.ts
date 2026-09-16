import { contextBridge, ipcRenderer } from 'electron';
import type { IpcApi, IpcNamespace, MainEvent } from '@shared/ipc/contract';
import { IPC_METHODS, IPC_NAMESPACES, MAIN_EVENT_CHANNEL, channelFor } from '@shared/ipc/contract';

/**
 * The only bridge between the renderer and anything privileged.
 *
 * The surface is built from IPC_METHODS as plain objects: contextBridge cannot
 * clone a Proxy, and attempting it fails the whole preload with "An object could
 * not be cloned", leaving window.api undefined. The manifest is compile-time
 * checked against IpcApi, so this stays in sync without being derived at runtime.
 */
function buildNamespace(ns: IpcNamespace): Record<string, unknown> {
  const surface: Record<string, unknown> = {};
  for (const method of IPC_METHODS[ns]) {
    const channel = channelFor(ns, method);
    surface[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
  }
  return surface;
}

type Handler = (event: MainEvent) => void;
const subscribers = new Map<MainEvent['type'], Set<Handler>>();

// One listener regardless of how many components subscribe.
ipcRenderer.on(MAIN_EVENT_CHANNEL, (_e, event: MainEvent) => {
  for (const handler of [...(subscribers.get(event.type) ?? [])]) {
    try {
      handler(event);
    } catch {
      // A throwing subscriber must not stop the others from being notified.
    }
  }
});

const api: Record<string, unknown> = {
  on(type: MainEvent['type'], handler: Handler): () => void {
    let set = subscribers.get(type);
    if (!set) {
      set = new Set();
      subscribers.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  },
};

for (const ns of IPC_NAMESPACES) api[ns] = buildNamespace(ns);

contextBridge.exposeInMainWorld('api', api as unknown as IpcApi);
