import type { Instant } from '../domain/models';

/**
 * Time enters the pure core through this interface and nowhere else. Every
 * scheduling decision is therefore reproducible in a test by supplying a fixed
 * instant — which is the only practical way to verify things like "fires at 18:00,
 * once, even after the laptop slept through four slots".
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test clock. Advanceable so a sequence of slots can be walked deterministically. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date | Instant) {
    this.current = typeof initial === 'string' ? new Date(initial) : new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(next: Date | Instant): void {
    this.current = typeof next === 'string' ? new Date(next) : new Date(next);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  advanceDays(days: number): void {
    this.advanceMinutes(days * 24 * 60);
  }
}
