import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';
import type { AppearanceSettings } from '@shared/domain/settings';
import { restoreWidgetBounds, saveWidgetBounds } from './windowState';

const DEFAULT_BOUNDS = { x: 0, y: 0, width: 380, height: 620 };

/**
 * The widget itself: frameless, transparent, always on top, absent from the
 * taskbar. On X11 (Cinnamon, the primary target) this behaves like a desklet.
 *
 * Wayland note: transparency and always-on-top are unreliable under some
 * compositors. See the README for the --ozone-platform=x11 fallback.
 */
export function createWidgetWindow(appearance: AppearanceSettings): BrowserWindow {
  const bounds = restoreWidgetBounds(DEFAULT_BOUNDS);

  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minWidth: 300,
    minHeight: 260,
    title: 'classroom-nz-widget',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // 'floating' keeps it above normal windows without fighting full-screen apps.
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setOpacity(appearance.opacity);
  if (appearance.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => win.show());

  const persist = () => saveWidgetBounds(win.getBounds());
  win.on('moved', persist);
  win.on('resized', persist);

  hardenNavigation(win);
  return win;
}

/**
 * A renderer must never navigate away or spawn a window of its own. Any link that
 * should open goes through the validated system.openExternal handler instead.
 */
export function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const isDevServer = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
    if (!isDevServer) event.preventDefault();
  });
}
