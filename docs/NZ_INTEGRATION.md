# nz.ua integration

## What we know

nz.ua publishes no API. There is a mobile app, so a mobile API exists —
`api-mobile.nz.ua` resolves — but it is undocumented.

More importantly, **nz.ua sits behind Cloudflare's interactive challenge.** Verified
2026-09-16:

```
$ curl -sI https://nz.ua/ -H 'User-Agent: Mozilla/5.0 … Chrome/140 …'
HTTP/2 403
cf-mitigated: challenge
server: cloudflare
…<title>Just a moment...</title>
```

`cf-mitigated: challenge` is the decisive part. This is not a User-Agent problem and
not something better headers fix — Cloudflare is demanding that the client execute a
JavaScript challenge. **No HTTP client can pass it.** Only a real browser can.

## What that means for the design

It inverts the obvious approach. The original plan had a direct HTTP client as the
primary transport with a browser as a fallback; the evidence says the opposite:

| | |
|---|---|
| **Primary** | `BrowserSessionTransport` — a real Electron `BrowserWindow` with its own persistent session partition |
| **Testing/CI** | `FixtureTransport` — recorded responses; CI never touches nz.ua |
| **Not implemented** | A direct HTTP transport. It would fail the challenge, so there is nothing to fall back to |

Requests are issued **inside the page** via `fetch`, not from Node with copied
cookies. A copied cookie on a Node request still has Node's TLS fingerprint and
header order, and gets challenged again. In-page `fetch` inherits the page's origin,
cookies, fingerprint and the Cloudflare clearance cookie for free.

This has a pleasant side effect: **the password is typed at nz.ua and never passes
through this app**, and a captcha or 2FA prompt simply appears for a human to solve.
That is why browser login is the default and storing a password is opt-in.

## What is still missing: the endpoints

The transport, request pacing, error classification and health reporting are built
and tested. What is *not* known is which paths to call.

They cannot be discovered from outside a logged-in browser — every request from
anywhere else returns the challenge page. So rather than ship invented paths that
would look authoritative and silently never work, `endpoints.ts` starts empty:

```ts
export const EMPTY_ENDPOINTS: NzEndpointConfig = {
  schedule: null, homework: null, grades: null, profile: null, …
};
```

While unconfigured, `NzProvider.capabilities()` returns an empty set. That is
deliberate — the widget then says *"Розклад надходить із nz.ua"* rather than showing
an empty timetable, which would look exactly like "no lessons today".

## Discovering the endpoints

This has to run on a machine with a logged-in nz.ua session — yours.

1. **Settings → Акаунти → nz.ua → Підключити.** A real nz.ua login window opens.
   Sign in as you normally would.
2. **Settings → Діагностика nz.ua → Почати запис.** The window reopens and records
   for 60 seconds.
3. **While it records, click around**: open the schedule, open homework, open grades.
   The recorder captures the XHR calls the site itself makes.
4. A report appears. Paste it back and the endpoint map can be filled in.

### What the report contains

**Paths and parameter names only.** No query values, no request bodies, no
responses — those carry the student's identifiers, class roster and grades.

```
Endpoints observed on nz.ua (paths and parameter names only):

GET   /api/v1/schedule  ?start_date&end_date  (x3, 200)
GET   /api/v1/homework  ?start_date&end_date  (x2, 200)
```

## Being a polite client

Every nz.ua request goes through one paced path that cannot be bypassed from a call
site (`NzProvider.send`):

- at most **one request per 5 seconds**, and **60 per hour**
- exponential backoff on failure, capped at 5 minutes
- an explicit `Retry-After` always outranks our own guess
- a **circuit breaker** opens for 30 minutes after 5 consecutive failures

A repeated bot check is classified as `WAF` and trips the breaker rather than being
retried — retrying a challenge is both futile and rude.

## A note on terms of service

Reading an undocumented API on behalf of an account you own is a grey area. This is
a personal family tool, and the rate limits above are deliberately conservative. It
would be a different matter to distribute this widely or to hammer the service.

nz.ua may change these endpoints without warning. When that happens, responses stop
matching their schemas, the affected capability is marked `broken`, the rest of the
app keeps working, and Settings → Diagnostics says exactly what died.
