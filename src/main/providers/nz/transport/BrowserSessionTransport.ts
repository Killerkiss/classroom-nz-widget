import { BrowserWindow, session } from 'electron';
import type { ProfileId } from '@shared/domain/ids';
import { log } from '@main/logging';
import { NZ_ORIGIN, NZ_LOGIN_PATH_HINTS } from '../endpoints';
import type { NzRawResponse, NzRequest, NzSessionState, NzTransport } from './NzTransport';
import { looksLikeChallenge } from './NzTransport';

const LOAD_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Talks to nz.ua through a real browser window.
 *
 * This is the primary transport, not a fallback. nz.ua sits behind Cloudflare's
 * interactive challenge — verified 2026-09-16, `cf-mitigated: challenge` with a
 * "Just a moment..." body — which no HTTP client can solve regardless of headers.
 * Only a real browser executing the challenge JavaScript obtains the clearance
 * cookie.
 *
 * Requests are issued *in-page* via fetch rather than from Node with copied
 * cookies, so they carry the page's origin, cookies, TLS fingerprint and header
 * order. A copied cookie on a Node request looks nothing like a browser and gets
 * challenged again.
 *
 * A pleasant side effect: the password is typed at nz.ua and never passes through
 * this code, and a captcha or 2FA prompt simply appears for the human to solve.
 */
export class BrowserSessionTransport implements NzTransport {
  readonly kind = 'browser-session' as const;
  private window: BrowserWindow | null = null;

  constructor(
    private readonly profileId: ProfileId,
    /** Called when the user must sign in; should surface the window. */
    private readonly onLoginRequired: (win: BrowserWindow) => void,
  ) {}

  async ensureSession(): Promise<NzSessionState> {
    const win = await this.ready();

    try {
      await this.load(win, NZ_ORIGIN);
    } catch (err) {
      log.warn(`[nz] could not load ${NZ_ORIGIN}: ${String(err)}`);
      return 'blocked';
    }

    const url = win.webContents.getURL();
    if (NZ_LOGIN_PATH_HINTS.some((hint) => url.includes(hint))) return 'login_required';

    const title = win.webContents.getTitle();
    // The challenge resolves itself given a moment; a persistent one means blocked.
    if (title.includes('Just a moment')) {
      await this.settle(win);
      return win.webContents.getTitle().includes('Just a moment') ? 'blocked' : 'ok';
    }

    return 'ok';
  }

  /** Show the window so the user can log in, and resolve once they have. */
  async promptLogin(): Promise<NzSessionState> {
    const win = await this.ready();
    await this.load(win, NZ_ORIGIN).catch(() => undefined);
    this.onLoginRequired(win);

    return new Promise((resolve) => {
      const check = () => {
        const url = win.webContents.getURL();
        if (!NZ_LOGIN_PATH_HINTS.some((hint) => url.includes(hint))) {
          win.webContents.off('did-navigate', check);
          win.webContents.off('did-navigate-in-page', check);
          win.hide();
          resolve('ok');
        }
      };
      win.webContents.on('did-navigate', check);
      win.webContents.on('did-navigate-in-page', check);
      win.once('closed', () => resolve('login_required'));
    });
  }

  async request(req: NzRequest): Promise<NzRawResponse> {
    const win = await this.ready();
    const url = new URL(req.path, NZ_ORIGIN);
    for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);

    // Run fetch inside the page: same origin, real cookies, real fingerprint.
    const script = `
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(url.toString())}, {
            method: ${JSON.stringify(req.method ?? 'GET')},
            credentials: 'include',
            headers: ${JSON.stringify({ Accept: 'application/json, text/plain, */*', ...req.headers })},
            ${req.body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(req.body))},`}
          });
          return {
            status: res.status,
            body: await res.text(),
            contentType: res.headers.get('content-type') || '',
            retryAfter: res.headers.get('retry-after') || null,
          };
        } catch (e) {
          return { status: 0, body: String(e && e.message ? e.message : e), contentType: '', retryAfter: null };
        }
      })()
    `;

    const raw = await withTimeout(
      win.webContents.executeJavaScript(script, true) as Promise<{
        status: number;
        body: string;
        contentType: string;
        retryAfter: string | null;
      }>,
      REQUEST_TIMEOUT_MS,
      'nz request timed out',
    );

    const retryAfterSeconds = raw.retryAfter ? Number(raw.retryAfter) : undefined;

    return {
      status: raw.status,
      body: raw.body,
      contentType: raw.contentType,
      challenged: looksLikeChallenge(raw.status, raw.body, raw.contentType),
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    };
  }

  /** The live window, for attaching an endpoint recorder to it. */
  async openForDiscovery(): Promise<BrowserWindow> {
    const win = await this.ready();
    await this.load(win, NZ_ORIGIN).catch(() => undefined);
    return win;
  }

  async dispose(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /** The partition is what makes the login survive a restart. */
  private async ready(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window;

    const partition = `persist:nz-${this.profileId}`;
    const win = new BrowserWindow({
      show: false,
      width: 980,
      height: 760,
      title: 'nz.ua',
      webPreferences: {
        partition,
        // No preload and no node access: this window renders a third-party site.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Keep the site inside this window; it must never spawn extra windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => {
      this.window = null;
    });

    void session.fromPartition(partition);
    this.window = win;
    return win;
  }

  private async load(win: BrowserWindow, url: string): Promise<void> {
    await withTimeout(win.loadURL(url), LOAD_TIMEOUT_MS, `timed out loading ${url}`);
    await this.settle(win);
  }

  /** Give a Cloudflare challenge a chance to complete on its own. */
  private async settle(win: BrowserWindow): Promise<void> {
    for (let i = 0; i < 15; i += 1) {
      if (!win.webContents.getTitle().includes('Just a moment')) return;
      await delay(1_000);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
