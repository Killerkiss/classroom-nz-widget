import { join } from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';

export interface TrayActions {
  toggleWidget: () => void;
  refresh: () => void;
  openSettings: () => void;
  quit: () => void;
}

export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip('classroom-nz-widget');

  const menu = Menu.buildFromTemplate([
    { label: 'Показати / сховати віджет', click: actions.toggleWidget },
    { label: 'Оновити зараз', click: actions.refresh },
    { type: 'separator' },
    { label: 'Налаштування…', click: actions.openSettings },
    { type: 'separator' },
    { label: 'Вийти', click: actions.quit },
  ]);

  tray.setContextMenu(menu);
  // Linux tray implementations often ignore click events entirely, so the context
  // menu above is the reliable path and this is a convenience on macOS.
  tray.on('click', actions.toggleWidget);
  return tray;
}

function trayIcon() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const image = nativeImage.createFromPath(join(import.meta.dirname, '../../build/tray', file));
  if (image.isEmpty()) return fallbackIcon();
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

/** A plain dot, so a missing asset degrades to a visible tray icon rather than none. */
function fallbackIcon() {
  const size = 22;
  const buffer = Buffer.alloc(size * size * 4);
  const centre = (size - 1) / 2;
  const radius = size * 0.36;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const distance = Math.hypot(x - centre, y - centre);
      const alpha = distance <= radius ? 255 : 0;
      buffer[i] = 0x4d;
      buffer[i + 1] = 0x8b;
      buffer[i + 2] = 0xff;
      buffer[i + 3] = alpha;
    }
  }
  const image = nativeImage.createFromBuffer(buffer, { width: size, height: size });
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
