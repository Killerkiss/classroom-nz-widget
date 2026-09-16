import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '@shared/ipc/contract';
import type { AppSettings } from '@shared/domain/settings';

/**
 * Snapshot state, seeded from the cache so the first paint is instant, then kept
 * current by pushes from main. A widget should never show a spinner as its first frame.
 */
export function useSnapshot(): {
  snapshot: Snapshot | null;
  refreshing: boolean;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void window.api.data.getSnapshot().then(setSnapshot);
    return window.api.on('snapshot:updated', (event) => {
      setSnapshot(event.snapshot);
      setRefreshing(false);
    });
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    window.api.data.refresh({ force: true }).finally(() => setRefreshing(false));
  }, []);

  return { snapshot, refreshing, refresh };
}

export function useSettings(): AppSettings | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void window.api.settings.get().then(setSettings);
    return window.api.on('settings:changed', (event) => setSettings(event.settings));
  }, []);

  return settings;
}

/**
 * Re-render exactly when the schedule selection expires, rather than polling.
 * `validUntil` comes from the same pure function that chose the day, so the flip
 * lands on the boundary instead of up to a minute late.
 */
export function useValidUntil(validUntil: string | undefined, onExpire: () => void): void {
  useEffect(() => {
    if (!validUntil) return;
    const delay = new Date(validUntil).getTime() - Date.now();
    if (delay <= 0) {
      onExpire();
      return;
    }
    // setTimeout saturates above ~24.8 days; the selection never reaches that.
    const timer = setTimeout(onExpire, Math.min(delay, 2_147_483_000));
    return () => clearTimeout(timer);
  }, [validUntil, onExpire]);
}
