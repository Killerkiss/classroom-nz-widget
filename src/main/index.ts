import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Tray } from 'electron';
import { app, BrowserWindow, powerMonitor } from 'electron';
import { asProfileId } from '@shared/domain/ids';
import type { ProfileId } from '@shared/domain/ids';
import type { AppSettings } from '@shared/domain/settings';
import type { ProfileSummary } from '@shared/ipc/contract';
import { MAIN_EVENT_CHANNEL } from '@shared/ipc/contract';
import { systemClock } from '@shared/core/clock';
import { AlertService } from './alerts/AlertService';
import { ElectronNotifier } from './alerts/notifier';
import type { AppContext } from './context';
import { envFileLocation, loadEnvFile } from './env';
import { broadcast, registerIpc } from './ipc/register';
import { log } from './logging';
import { buildProviders } from './providers/registry';
import { EndpointRecorder } from './providers/nz/discovery';
import { BrowserSessionTransport } from './providers/nz/transport/BrowserSessionTransport';
import type { SchoolDataProvider } from './providers/SchoolDataProvider';
import { CacheStore } from './storage/cacheStore';
import { SafeStorageSecretStore } from './storage/secrets/SafeStorageSecretStore';
import { SessionOnlySecretStore } from './storage/secrets/SessionOnlySecretStore';
import type { SecretStore } from './storage/secrets/SecretStore';
import { SettingsStore } from './storage/settingsStore';
import { Scheduler } from './sync/scheduler';
import { SyncService } from './sync/SyncService';
import { createTray } from './tray/tray';
import { getSettingsWindow, openSettingsWindow } from './windows/settingsWindow';
import { createWidgetWindow } from './windows/widgetWindow';

// A second instance would fight the first over the cache and fire duplicate alerts.
if (!app.requestSingleInstanceLock()) app.quit();

let widget: BrowserWindow | null = null;
let tray: Tray | null = null;
let providers: SchoolDataProvider[] = [];

const scheduler = new Scheduler();
const SYNC_TIMER = 'sync';

app.whenReady().then(() => {
  app.setAppUserModelId('com.killerkiss.classroom-nz-widget');

  const envFile = loadEnvFile();
  log.info(envFile ? `Loaded credentials from ${envFile}` : `No .env found (expected at ${envFileLocation()})`);
  app.on('browser-window-created', (_e, win) => watchWindowShortcuts(win));

  const settings = new SettingsStore();
  const cache = new CacheStore();
  const secrets = createSecretStore();

  log.info(`Secret storage backend: ${secrets.info.backend} (encrypted: ${secrets.info.isEncryptedAtRest})`);
  if (secrets.info.warning) log.warn(secrets.info.warning);

  const showLoginWindow = (win: BrowserWindow) => {
    // The widget is always-on-top and would otherwise sit over the login page.
    widget?.setAlwaysOnTop(false, 'floating');
    win.show();
    win.focus();
    win.once('hide', () => widget?.setAlwaysOnTop(true, 'floating'));
    win.once('closed', () => widget?.setAlwaysOnTop(true, 'floating'));
  };

  const refreshProviders = () => {
    providers = buildProviders(settings, secrets, showLoginWindow);
  };
  refreshProviders();

  const sync = new SyncService(settings, cache, systemClock, () => providers, (snapshot) => {
    broadcast(BrowserWindow.getAllWindows(), MAIN_EVENT_CHANNEL, { type: 'snapshot:updated', snapshot });
    alerts.evaluate();
  });

  const alerts = new AlertService(cache, settings, scheduler, new ElectronNotifier(), systemClock, (assignmentId) => {
    widget?.show();
    broadcast(BrowserWindow.getAllWindows(), MAIN_EVENT_CHANNEL, {
      type: 'navigate',
      view: 'assignment',
      id: assignmentId,
    });
  });

  widget = createWidgetWindow(settings.get().appearance);
  loadRenderer(widget, 'index.html');

  const ctx: AppContext = {
    settings,
    cache,
    secrets,
    sync,
    alerts,
    providers: () => providers,
    widget: () => widget,
    openSettings: () => {
      openSettingsWindow(
        (win) => loadRenderer(win, 'settings.html'),
        // Step the widget out of the way so it cannot cover the settings window.
        (focused) => widget?.setAlwaysOnTop(!focused, 'floating'),
      );
    },
    broadcastSnapshot: () => {
      broadcast(BrowserWindow.getAllWindows(), MAIN_EVENT_CHANNEL, {
        type: 'snapshot:updated',
        snapshot: sync.snapshot(),
      });
    },
    onSettingsChanged: (next) => {
      applySettings(next);
      refreshProviders();
      broadcast(BrowserWindow.getAllWindows(), MAIN_EVENT_CHANNEL, { type: 'settings:changed', settings: next });
      alerts.evaluate();
      armSyncTimer(next);
    },
    addGoogleAccount: async (): Promise<ProfileSummary> => {
      const id = asProfileId(randomUUID());
      const secretKeyRef = `google:${id}:refresh_token`;

      settings.patch({
        profiles: [
          ...settings.get().profiles,
          { id, source: 'google-classroom', displayName: 'Google Classroom', secretKeyRef, enabled: true },
        ],
      });
      refreshProviders();

      const provider = providers.find((p) => p.profileId === id);
      if (!provider) throw new Error('Failed to create the Google provider.');

      try {
        await provider.authenticate();
      } catch (err) {
        // Do not leave a dead profile behind if sign-in was cancelled or failed.
        await removeProfile(settings, secrets, id);
        refreshProviders();
        throw err;
      }

      void sync.refresh(true);
      return { id, source: 'google-classroom', displayName: provider.displayName, status: 'authenticated' };
    },
    addNzAccount: async (): Promise<ProfileSummary> => {
      const id = asProfileId(randomUUID());

      settings.patch({
        profiles: [
          ...settings.get().profiles,
          {
            id,
            source: 'nz',
            displayName: 'nz.ua',
            // Browser login by default: the password is typed at nz.ua and never
            // reaches this app, so there is nothing here to store.
            secretKeyRef: `nz:${id}:session`,
            enabled: true,
            nzAuthMode: 'browser',
          },
        ],
      });
      refreshProviders();

      const transport = new BrowserSessionTransport(id, showLoginWindow);
      try {
        const state = await transport.promptLogin();
        if (state !== 'ok') throw new Error('Вхід на nz.ua не завершено.');
      } catch (err) {
        await removeProfile(settings, secrets, id);
        refreshProviders();
        throw err;
      } finally {
        await transport.dispose();
      }

      void sync.refresh(true);
      return { id, source: 'nz', displayName: 'nz.ua', status: 'authenticated' };
    },

    runNzDiscovery: async (profileId: ProfileId, seconds: number): Promise<string> => {
      const transport = new BrowserSessionTransport(profileId, showLoginWindow);
      try {
        const state = await transport.ensureSession();
        if (state === 'login_required') await transport.promptLogin();

        const win = await transport.openForDiscovery();
        const recorder = new EndpointRecorder(win);
        recorder.start();
        showLoginWindow(win);

        // The user browses their schedule and homework while this records.
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(seconds, 10), 300) * 1000));
        return recorder.report();
      } finally {
        await transport.dispose();
      }
    },

    signOut: async (profileId: ProfileId) => {
      const provider = providers.find((p) => p.profileId === profileId);
      await provider?.signOut();
      await removeProfile(settings, secrets, profileId);
      refreshProviders();
      ctx.broadcastSnapshot();
    },
  };

  registerIpc(ctx);

  tray = createTray({
    toggleWidget: () => (widget?.isVisible() ? widget.hide() : widget?.show()),
    refresh: () => void sync.refresh(true),
    openSettings: ctx.openSettings,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  applySettings(settings.get());
  armSyncTimer(settings.get());

  // Paint from cache immediately, then refresh in the background.
  ctx.broadcastSnapshot();
  alerts.evaluate();
  void sync.refresh(false);

  // Timers do not fire reliably across sleep, so re-evaluate on wake.
  powerMonitor.on('resume', () => {
    log.info('System resumed — re-evaluating alerts and syncing.');
    alerts.evaluate();
    if (settings.get().sync.syncOnResume) void sync.refresh(false);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      widget = createWidgetWindow(settings.get().appearance);
      loadRenderer(widget, 'index.html');
    } else {
      widget?.show();
    }
  });

  function armSyncTimer(next: AppSettings): void {
    scheduler.every(SYNC_TIMER, Math.max(1, next.sync.refreshIntervalMinutes) * 60_000, () => {
      void sync.refresh(false);
    });
  }

  function applySettings(next: AppSettings): void {
    if (!widget || widget.isDestroyed()) return;
    widget.setOpacity(next.appearance.opacity);
    widget.setIgnoreMouseEvents(next.appearance.clickThrough, { forward: true });
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
  }
});

let isQuitting = false;

app.on('second-instance', () => {
  widget?.show();
  getSettingsWindow()?.focus();
});

// The widget is a background utility: closing a window should not quit the app.
app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  scheduler.cancelAll();
  tray?.destroy();
});

/** F12 opens devtools in development; Ctrl+R reload is blocked in production. */
function watchWindowShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      if (process.env.ELECTRON_RENDERER_URL) win.webContents.toggleDevTools();
      return;
    }
    if (!process.env.ELECTRON_RENDERER_URL && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) {
      event.preventDefault();
    }
  });
}

function createSecretStore(): SecretStore {
  const store = new SafeStorageSecretStore();
  return store.info.backend === 'unavailable' ? new SessionOnlySecretStore() : store;
}

async function removeProfile(settings: SettingsStore, secrets: SecretStore, id: ProfileId): Promise<void> {
  const profile = settings.get().profiles.find((p) => p.id === id);
  if (profile) await secrets.delete(profile.secretKeyRef);
  settings.patch({ profiles: settings.get().profiles.filter((p) => p.id !== id) });
}

function loadRenderer(win: BrowserWindow, page: string): void {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) void win.loadURL(`${devServer}/${page}`);
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}`));
}
