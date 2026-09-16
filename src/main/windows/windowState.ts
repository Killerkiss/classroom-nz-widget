import Store from 'electron-store';
import { screen } from 'electron';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Schema {
  widget: Bounds | null;
}

const store = new Store<Schema>({ name: 'window-state', defaults: { widget: null } });

export function saveWidgetBounds(bounds: Bounds): void {
  store.set('widget', bounds);
}

/**
 * Restore the widget's position, clamped onto a display that currently exists.
 *
 * Without the clamp, unplugging the monitor the widget was parked on leaves it at
 * coordinates no screen covers — the window is "open" and permanently invisible.
 */
export function restoreWidgetBounds(fallback: Bounds): Bounds {
  const saved = store.get('widget');
  if (!saved) return centreOnPrimary(fallback);

  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const a = d.workArea;
    return (
      saved.x < a.x + a.width &&
      saved.x + saved.width > a.x &&
      saved.y < a.y + a.height &&
      saved.y + saved.height > a.y
    );
  });

  return visible ? saved : centreOnPrimary({ ...fallback, width: saved.width, height: saved.height });
}

function centreOnPrimary(bounds: Bounds): Bounds {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: bounds.width,
    height: bounds.height,
    // Top-right by default: where a desktop widget belongs, clear of most launchers.
    x: Math.round(area.x + area.width - bounds.width - 24),
    y: Math.round(area.y + 24),
  };
}
