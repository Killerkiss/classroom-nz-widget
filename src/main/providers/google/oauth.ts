import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';
import { ProviderError } from '@shared/domain/errors';
import { log } from '@main/logging';

/** Read-only throughout. "Mark done" is local, so no write scope is requested. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'openid',
  'email',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * For an installed app the client secret is, by Google's own definition, not
 * confidential — it ships inside the binary. PKCE is what actually protects the
 * flow. These are injected at build time rather than committed.
 */
export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export function loadClientConfig(): OAuthClientConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  if (!clientId) {
    throw new ProviderError({
      kind: 'AUTH',
      source: 'google-classroom',
      message:
        'No Google OAuth client is configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — see docs/GOOGLE_SETUP.md.',
    });
  }
  return { clientId, clientSecret };
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry, ms since epoch. */
  expiresAt: number;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * The installed-app flow: PKCE over a loopback listener on an ephemeral port.
 * Never the deprecated out-of-band flow.
 */
export async function runAuthorizationFlow(config: OAuthClientConfig): Promise<TokenSet> {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  const state = base64Url(randomBytes(16));

  const { code, redirectUri, close } = await listenForCode(state, (uri) => {
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', uri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    // Force the consent screen so a refresh token is always issued, not just the
    // first time this account ever authorized the app.
    url.searchParams.set('prompt', 'consent');
    void shell.openExternal(url.toString());
  });

  try {
    return await exchange(config, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  } finally {
    close();
  }
}

export async function refreshAccessToken(
  config: OAuthClientConfig,
  refreshToken: string,
): Promise<TokenSet> {
  const tokens = await exchange(config, { grant_type: 'refresh_token', refresh_token: refreshToken });
  // Google omits the refresh token on refresh; keep the one we already hold.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

async function exchange(
  config: OAuthClientConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    ...params,
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await response.json()) as TokenResponse;

  if (!response.ok || json.error) {
    throw new ProviderError({
      kind: 'AUTH',
      source: 'google-classroom',
      status: response.status,
      message: json.error_description ?? json.error ?? `Token exchange failed (${response.status})`,
    });
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

const TIMEOUT_MS = 5 * 60_000;

/** Bind 127.0.0.1 on an ephemeral port and wait for Google to redirect back. */
function listenForCode(
  expectedState: string,
  openBrowser: (redirectUri: string) => void,
): Promise<{ code: string; redirectUri: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;

    const close = () => server.close();
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      close();
      reject(err);
    };

    const timer = setTimeout(
      () => fail(new ProviderError({ kind: 'AUTH', source: 'google-classroom', message: 'Sign-in timed out.' })),
      TIMEOUT_MS,
    );

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(error ? 'Не вдалося увійти. Можна закрити цю вкладку.' : 'Готово! Можна закрити цю вкладку.'));

      if (settled) return;

      if (error) return fail(new ProviderError({ kind: 'AUTH', source: 'google-classroom', message: error }));
      // A mismatched state means this redirect is not the one we started.
      if (returnedState !== expectedState) {
        return fail(new ProviderError({ kind: 'AUTH', source: 'google-classroom', message: 'OAuth state mismatch.' }));
      }
      if (!code) return fail(new ProviderError({ kind: 'AUTH', source: 'google-classroom', message: 'No authorization code returned.' }));

      settled = true;
      clearTimeout(timer);
      resolve({ code, redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close });
    });

    server.on('error', fail);

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      log.info(`OAuth loopback listening on 127.0.0.1:${port}`);
      openBrowser(`http://127.0.0.1:${port}`);
    });
  });
}

const page = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>classroom-nz-widget</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0f1117;color:#e6e8ef">
<p>${message}</p></body>`;

const base64Url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
