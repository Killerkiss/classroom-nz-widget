/**
 * The only module permitted to call setTimeout/setInterval (enforced by ESLint).
 * Keeping every timer here means alert firing has exactly one place to audit.
 */

/**
 * Node timers do not fire reliably across OS sleep, and a far-future timeout can
 * drift. Waking at least this often lets the engine re-evaluate and self-correct.
 */
const MAX_SLEEP_MS = 15 * 60_000;

export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Wake at `at`, clamped so no single sleep exceeds MAX_SLEEP_MS. Re-arming the
   * same name replaces the pending timer rather than stacking a second one.
   */
  wakeAt(name: string, at: Date | string | null, callback: () => void): void {
    this.cancel(name);
    if (!at) return;

    const target = typeof at === 'string' ? new Date(at).getTime() : at.getTime();
    if (Number.isNaN(target)) return;

    const delay = Math.max(0, target - Date.now());
    const sleep = Math.min(delay, MAX_SLEEP_MS);

    const timer = setTimeout(() => {
      this.timers.delete(name);
      if (sleep < delay) {
        // Clamped: this was an intermediate wake, so go back to sleep.
        this.wakeAt(name, at, callback);
        return;
      }
      callback();
    }, sleep);

    this.timers.set(name, timer);
  }

  every(name: string, intervalMs: number, callback: () => void): void {
    this.cancel(name);
    this.timers.set(name, setInterval(callback, intervalMs));
  }

  cancel(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(name);
    }
  }

  cancelAll(): void {
    for (const name of [...this.timers.keys()]) this.cancel(name);
  }
}
