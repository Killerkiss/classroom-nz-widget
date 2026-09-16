import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { hardenNavigation } from './widgetWindow';

let current: BrowserWindow | null = null;

/** A normal, chrome-having window — the opposite of the widget in every respect. */
export function openSettingsWindow(
  loadUrl: (win: BrowserWindow) => void,
  /**
   * Called when settings takes or loses focus. The widget is always-on-top and
   * would otherwise sit on top of the settings window the user is trying to read.
   */
  onFocusChange?: (focused: boolean) => void,
): BrowserWindow {
  if (current && !current.isDestroyed()) {
    current.focus();
    return current;
  }

  const win = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Налаштування',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('focus', () => onFocusChange?.(true));
  win.on('blur', () => onFocusChange?.(false));
  win.on('closed', () => {
    current = null;
    onFocusChange?.(false);
  });

  hardenNavigation(win);
  loadUrl(win);
  current = win;
  return win;
}

export function getSettingsWindow(): BrowserWindow | null {
  return current && !current.isDestroyed() ? current : null;
}
