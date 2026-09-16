import type { BrowserWindow} from 'electron';
import { app, ipcMain, shell } from 'electron';
import { z } from 'zod';
import { asAssignmentId, asProfileId } from '@shared/domain/ids';
import type { DiagnosticsReport, IpcNamespace, ProfileSummary } from '@shared/ipc/contract';
import { channelFor } from '@shared/ipc/contract';
import { CACHE_SCHEMA_VERSION } from '@main/storage/cacheStore';
import { SETTINGS_SCHEMA_VERSION } from '@shared/domain/settings';
import { log } from '@main/logging';
import type { AppContext } from '@main/context';

const assignmentId = z.string().min(1);
const minutes = z.number().int().positive().max(24 * 60);

/**
 * Every handler lives here so the privileged surface is one auditable list.
 * Arguments are validated even though they come from our own renderer — it is
 * untrusted in principle, and in practice this catches our own bugs early.
 */
export function registerIpc(ctx: AppContext): void {
  const handle = <A extends unknown[], R>(
    ns: IpcNamespace,
    method: string,
    fn: (...args: A) => R | Promise<R>,
  ): void => {
    ipcMain.handle(channelFor(ns, method), async (_event, ...args) => {
      try {
        return await fn(...(args as A));
      } catch (err) {
        log.error(`[ipc] ${ns}:${method} failed`, err);
        throw err;
      }
    });
  };

  // ---- data ----
  handle('data', 'getSnapshot', () => ctx.sync.snapshot());
  handle('data', 'refresh', async (opts?: { force?: boolean }) => {
    await ctx.sync.refresh(opts?.force ?? false);
  });
  handle('data', 'getAssignment', (rawId: unknown) => {
    const id = assignmentId.parse(rawId);
    const data = ctx.cache.read();
    const assignment = data.assignments.find((a) => a.id === id);
    if (!assignment) return null;
    return {
      assignment,
      course: data.courses.find((c) => c.id === assignment.courseId),
      announcements: data.announcements.filter((a) => a.courseId === assignment.courseId).slice(0, 5),
    };
  });

  // ---- alerts ----
  handle('alerts', 'snooze', (rawId: unknown, rawMinutes: unknown) => {
    ctx.alerts.snooze(asAssignmentId(assignmentId.parse(rawId)), minutes.parse(rawMinutes));
  });
  handle('alerts', 'dismiss', (rawId: unknown) => {
    ctx.alerts.dismiss(asAssignmentId(assignmentId.parse(rawId)));
  });
  handle('alerts', 'markDone', (rawId: unknown, rawDone: unknown) => {
    ctx.alerts.markDone(asAssignmentId(assignmentId.parse(rawId)), z.boolean().parse(rawDone));
    ctx.broadcastSnapshot();
  });

  // ---- settings ----
  handle('settings', 'get', () => ctx.settings.get());
  handle('settings', 'patch', (patch: unknown) => {
    const next = ctx.settings.patch(z.record(z.string(), z.unknown()).parse(patch));
    ctx.onSettingsChanged(next);
    return next;
  });
  handle('settings', 'reset', () => {
    const next = ctx.settings.reset();
    ctx.onSettingsChanged(next);
    return next;
  });

  // ---- auth ----
  handle('auth', 'status', async (): Promise<ProfileSummary[]> => {
    const providers = ctx.providers();
    const settled = await Promise.allSettled(
      providers.map(async (p) => ({
        id: p.profileId,
        source: p.source,
        displayName: p.displayName,
        status: await p.authStatus(),
      })),
    );

    const summaries: ProfileSummary[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'rejected') {
        log.warn(`[auth] status check failed for "${providers[i]?.displayName}": ${String(outcome.reason)}`);
        return;
      }
      summaries.push(outcome.value);
    });
    return summaries;
  });

  handle('auth', 'addGoogleAccount', () => ctx.addGoogleAccount());
  handle('auth', 'addNzAccount', () => ctx.addNzAccount());
  handle('auth', 'signOut', async (rawId: unknown) => {
    await ctx.signOut(asProfileId(z.string().min(1).parse(rawId)));
  });
  handle('auth', 'secretBackend', () => ctx.secrets.info);

  // ---- window ----
  handle('window', 'openSettings', () => ctx.openSettings());
  handle('window', 'hideWidget', () => ctx.widget()?.hide());
  handle('window', 'setClickThrough', (rawEnabled: unknown) => {
    const enabled = z.boolean().parse(rawEnabled);
    ctx.widget()?.setIgnoreMouseEvents(enabled, { forward: true });
    ctx.settings.patch({ appearance: { clickThrough: enabled } });
  });

  // ---- system ----
  handle('system', 'openExternal', async (rawUrl: unknown) => {
    const url = z.string().url().parse(rawUrl);
    // Only https. Handing a provider-supplied URL straight to the shell would let a
    // file:// or custom-scheme URL launch something local.
    if (!url.startsWith('https://')) {
      throw new Error(`Refusing to open a non-https URL: ${url.slice(0, 40)}`);
    }
    await shell.openExternal(url);
  });

  handle('system', 'getVersion', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
  }));

  handle('system', 'runNzDiscovery', (rawProfileId: unknown, rawSeconds: unknown) =>
    ctx.runNzDiscovery(
      asProfileId(z.string().min(1).parse(rawProfileId)),
      z.number().int().min(10).max(300).parse(rawSeconds),
    ),
  );

  handle('system', 'getDiagnostics', (): DiagnosticsReport => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
    secretBackend: ctx.secrets.info,
    health: ctx.cache.read().health,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
  }));
}

export function unregisterIpc(): void {
  ipcMain.removeHandler('__noop__');
}

export function broadcast(windows: BrowserWindow[], channel: string, payload: unknown): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
