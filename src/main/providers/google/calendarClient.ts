import { ProviderError } from '@shared/domain/errors';
import type { AccessTokenProvider } from './classroomClient';

const BASE = 'https://www.googleapis.com/calendar/v3';

export interface GEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GEntryPoint {
  entryPointType?: 'video' | 'phone' | 'sip' | 'more';
  uri?: string;
  label?: string;
}

export interface GEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: GEventDateTime;
  end?: GEventDateTime;
  htmlLink?: string;
  /** Legacy Meet field, still populated for events created with a Meet room. */
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: GEntryPoint[];
    conferenceSolution?: { name?: string };
  };
}

export interface CalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
}

/**
 * Reads calendar events purely to find conferencing links for lessons — Classroom
 * exposes no Meet link on a course, so this is the only Google-side source.
 */
export class CalendarClient {
  constructor(private readonly getAccessToken: AccessTokenProvider) {}

  async listCalendars(signal: AbortSignal): Promise<CalendarListEntry[]> {
    return this.paged<CalendarListEntry>('/users/me/calendarList', {}, 'items', signal);
  }

  async listEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string,
    signal: AbortSignal,
  ): Promise<GEvent[]> {
    return this.paged<GEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeMin,
        timeMax,
        // Expand recurring events, which is what a weekly lesson actually is.
        singleEvents: 'true',
        orderBy: 'startTime',
      },
      'items',
      signal,
    );
  }

  private async paged<T>(
    path: string,
    params: Record<string, string>,
    key: string,
    signal: AbortSignal,
  ): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(BASE + path);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set('maxResults', '250');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const body = await this.request<Record<string, unknown>>(url, signal);
      const items = body[key];
      if (Array.isArray(items)) out.push(...(items as T[]));
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
    } while (pageToken);

    return out;
  }

  private async request<T>(url: URL, signal: AbortSignal): Promise<T> {
    const token = await this.getAccessToken();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
      });
    } catch (err) {
      throw new ProviderError(
        { kind: 'NETWORK', source: 'google-classroom', message: (err as Error).message },
        { cause: err },
      );
    }

    if (response.ok) return (await response.json()) as T;

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError({
        kind: 'AUTH',
        source: 'google-classroom',
        status: response.status,
        message: `Google Calendar rejected the request (${response.status}).`,
      });
    }
    if (response.status === 429) {
      throw new ProviderError({ kind: 'RATE_LIMIT', source: 'google-classroom', status: 429, message: 'Rate limited.' });
    }
    throw new ProviderError({
      kind: 'UNKNOWN',
      source: 'google-classroom',
      status: response.status,
      message: `Calendar request failed (${response.status}).`,
    });
  }
}
