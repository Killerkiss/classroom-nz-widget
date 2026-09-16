import { describe, expect, it } from 'vitest';
import { EMPTY_ENDPOINTS, isConfigured, isInterestingEndpoint } from '@main/providers/nz/endpoints';

describe('isConfigured', () => {
  it('is false until endpoints are discovered', () => {
    // The app must say "no timetable source" rather than show an empty timetable.
    expect(isConfigured(EMPTY_ENDPOINTS)).toBe(false);
  });

  it('is true once a data endpoint is known', () => {
    expect(isConfigured({ ...EMPTY_ENDPOINTS, schedule: '/api/v1/schedule' })).toBe(true);
    expect(isConfigured({ ...EMPTY_ENDPOINTS, homework: '/api/v1/homework' })).toBe(true);
  });
});

describe('isInterestingEndpoint', () => {
  it('keeps nz.ua application requests', () => {
    expect(isInterestingEndpoint('https://nz.ua/api/v1/schedule?from=1')).toBe(true);
    expect(isInterestingEndpoint('https://api-mobile.nz.ua/v1/homework')).toBe(true);
  });

  it('drops other hosts entirely', () => {
    expect(isInterestingEndpoint('https://www.google-analytics.com/collect')).toBe(false);
    expect(isInterestingEndpoint('https://fonts.googleapis.com/css')).toBe(false);
  });

  it('drops static assets', () => {
    for (const url of [
      'https://nz.ua/assets/app.js',
      'https://nz.ua/style.css',
      'https://nz.ua/logo.svg',
      'https://nz.ua/font.woff2',
      'https://nz.ua/app.js.map',
    ]) {
      expect(isInterestingEndpoint(url)).toBe(false);
    }
  });

  it("drops Cloudflare's own traffic", () => {
    expect(isInterestingEndpoint('https://nz.ua/cdn-cgi/challenge-platform/h/b/jsd')).toBe(false);
  });

  it('does not throw on a malformed url', () => {
    expect(isInterestingEndpoint('not a url')).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    expect(isInterestingEndpoint('https://nz.ua.evil.com/api')).toBe(false);
    // A bare endsWith('nz.ua') would wrongly accept this one.
    expect(isInterestingEndpoint('https://evilnz.ua/api')).toBe(false);
    expect(isInterestingEndpoint('https://sub.nz.ua/api')).toBe(true);
  });
});
