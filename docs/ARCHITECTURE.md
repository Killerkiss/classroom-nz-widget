# Architecture

## The problem

Schedule and homework live in two systems that don't talk to each other:

- **Google Classroom** has coursework, due dates and submission state — but **no
  timetable**. There are no periods or times in the API, and `Course` has no Meet
  link field.
- **nz.ua** has the bell schedule, homework and grades — but **no public API**.
  `api-mobile.nz.ua` resolves and is what the official mobile app uses, but it sits
  behind a WAF and is undocumented.

So: nz.ua is the source of record for *when*, Google Classroom for *what's due and
whether it's done*, and Meet links come from whichever source actually has them.

## Principles

1. **The pure core owns all logic.** Everything in `src/shared/core/` is a pure
   function of `(now, data, settings)`. No I/O, no `Date.now()`, no timers. This is
   what makes the 18:00 flip and the alert cadence testable instead of hopeful.
2. **Providers fetch and normalize, nothing more.** They never decide anything.
3. **A failing source is a normal state, not an error.** If nz.ua breaks, the
   Classroom half keeps working, and vice versa.
4. **The main process owns everything dangerous** — network, disk, secrets, timers.
   The renderer only draws.

## Layout

```
src/
├─ shared/          # zero electron/node imports — runs in both worlds
│  ├─ domain/       # models.ts, settings.ts, errors.ts, ids.ts
│  ├─ core/         # THE PURE CORE
│  │  ├─ clock.ts             # Clock interface + SystemClock + FixedClock
│  │  ├─ timezone.ts          # Europe/Kyiv civil-date helpers
│  │  ├─ scheduleView.ts      # selectScheduleDay(now, settings)
│  │  ├─ alerts/              # engine.ts (pure), quietHours.ts, types.ts
│  │  ├─ merge/               # dedupeKey.ts, mergeAssignments.ts, subjectDictionary.ts
│  │  └─ meet/resolveMeetLink.ts
│  └─ ipc/          # contract.ts (IpcApi), events.ts (MainEvent union)
├─ preload/         # contextBridge -> window.api, derived from contract.ts
├─ main/
│  ├─ windows/      # widgetWindow, settingsWindow, authWindow, windowState
│  ├─ tray/, ipc/
│  ├─ providers/    # SchoolDataProvider.ts, registry.ts, google/, nz/
│  ├─ sync/         # SyncService, scheduler.ts (ONLY timers in the app), backoff
│  ├─ alerts/       # AlertService (impure shell), notifier, alertStore
│  └─ storage/      # settingsStore, cacheStore, secrets/
└─ renderer/        # widget/ + settings/
```

One `package.json`, **no npm workspaces** — `electron-vite` already isolates the
three build graphs, and workspaces plus electron-builder is a known packaging trap.
Path aliases `@shared/*`, `@main/*`, `@renderer/*`, with an ESLint
`no-restricted-imports` rule stopping the renderer reaching into main.

## Provider abstraction

Both sources implement one `SchoolDataProvider` interface, normalizing into shared
`Course` / `Lesson` / `Assignment` / `Attachment` models.

Every provider is wrapped in a **`SafeProvider` decorator** that catches everything,
classifies it into a `ProviderError` (`AUTH | WAF | SCHEMA_DRIFT | NETWORK |
RATE_LIMIT | UNKNOWN`), records it into `ProviderHealth`, and returns an empty
result. This single decorator is what makes "nz.ua broke" a non-event for the rest
of the app.

Providers also declare **capabilities** (`courses`, `timetable`, `homework`,
`submissions`, `grades`, `announcements`, `attachments`, `meetLinks`), so the UI can
distinguish "no homework" from "this source can't tell us about homework".

### Cross-source merge

The same homework can appear in both systems with no shared identifier. Dedupe is
therefore heuristic and **deliberately conservative** — a false merge hides a real
assignment, which is the one failure mode that actually gets a student in trouble.

1. **Explicit** — nz.ua homework text contains a `classroom.google.com/c/…/a/<id>`
   URL. Merge unconditionally.
2. **Strong** — `subjectKey + dueDate + titleFingerprint`, *and* description token
   overlap (Jaccard ≥ 0.5) or one description empty. Merge.
3. **Weak** — `subjectKey + dueDate` only. **Do not merge.** Surface as "possibly
   the same as…" and let the user confirm once; the confirmation is persisted.

Field precedence when merging: submission state from Classroom (it actually knows),
grade from nz.ua (the official 12-point journal), due date = earliest non-null (safer
to alert early), description = longest, attachments = union. Every winner is recorded
in `provenance` so the detail panel can show "due date from nz.ua, status from
Classroom" — when the two disagree, the student needs to see it, not have it silently
resolved.

`subjectKey` normalizes subject names across systems ("Алгебра та початки аналізу" →
`algebra`) via a dictionary that is user-extensible from Settings, because Ukrainian
subject naming across two systems *will* disagree and that shouldn't need a release.

## nz.ua risk containment

nz.ua is the unbounded risk in this project. Five layers contain it:

1. **Transport abstraction.** `NzTransport` has three implementations: `HttpTransport`
   (primary — direct requests from the main process), `BrowserSessionTransport`
   (fallback — hidden `BrowserWindow` with a real login, requests made in-page so the
   WAF sees a genuine browser), and `FixtureTransport` (recorded responses, for dev
   and CI). On repeated 403/challenge responses the provider flips to the browser
   transport and remembers that choice; it never flaps back automatically.
2. **Every response goes through zod.** Unknown fields pass through; a *renamed*
   field degrades one capability rather than crashing. Parse failures log a redacted
   shape summary (key names and types only, never values).
3. **Capability probe** on startup records which endpoints actually work, shown as a
   live table in Settings → Diagnostics. When nz.ua changes, this says exactly what
   died.
4. **Fixtures** for offline dev and CI. CI never hits nz.ua — besides being rude,
   GitHub Actions runners are datacenter IPs, which is precisely what gets a 403.
5. **Rate limiting is non-bypassable**: max 1 request / 5s, ~60/hour, exponential
   backoff with jitter, circuit breaker opening for 30 min after 5 consecutive
   failures.

## Secrets

**Electron `safeStorage` only** — not `keytar`, which is archived, needs native
rebuilds per Electron ABI, and pulls `libsecret` as a runtime dependency.

Ciphertext blobs live in `secrets.json` in `userData`, never in the settings file.

On Linux, `safeStorage.getSelectedStorageBackend()` must be checked:

| Backend | Meaning | Policy |
|---|---|---|
| `gnome_libsecret`, `kwallet*` | Real keyring | Normal operation |
| `basic_text` | **Hardcoded key — this is obfuscation, not encryption** | Warn in Settings; refuse to persist an nz.ua password |
| unavailable | No storage | In-memory only, cleared on quit |

The `basic_text` case is the subtle one: on a normal Mint desktop you'll never hit
it, but on a headless or autologin machine tokens would silently be stored under a
key that ships in Electron's source.

**Never written in plaintext:** refresh / access / id tokens, the PKCE verifier, the
OAuth client secret, nz.ua passwords, session cookies and CSRF tokens, and raw API
responses (they contain the full class roster and grades — the cache stores only
mapped domain objects). Logs pass through a redacting transport.

### nz.ua login

Default is **browser-popup login**: a real nz.ua login page in an Electron window
with its own session partition. The password is typed at nz.ua and never touches
this code; captcha and 2FA work because a human is present. Storing a password for
silent re-login is an **opt-in** toggle, and is refused outright when no real keyring
is available.

### Google OAuth

Installed-app flow with **PKCE + loopback** on `http://127.0.0.1:<random-port>` —
never the deprecated OOB flow. Read-only scopes only:

```
classroom.courses.readonly
classroom.coursework.me.readonly
classroom.student-submissions.me.readonly
classroom.announcements.readonly
calendar.events.readonly
```

The consent screen is published **"In production" (unverified)**. This matters: in
"Testing" status Google revokes refresh tokens after 7 days, which would mean a
weekly re-login. The cost is a one-time "Google hasn't verified this app"
interstitial (Advanced → Continue) and a 100-user lifetime cap — both irrelevant for
family use.

For a desktop app the client secret is, by Google's own definition, not confidential.
It is kept in the main bundle (never the renderer) and injected at build time.

"Mark as done" is **local-only** — it silences alerts without needing a write scope,
which solves the actual problem at a fraction of the OAuth risk profile.

## Time

All reasoning about "which day" and "18:00" happens in **`Europe/Kyiv`, never the OS
timezone** — the family may travel, the school day does not move. Instants are stored
as UTC ISO strings, school dates as `YYYY-MM-DD` strings. Never a naked `Date`, never
`getHours()`.

`date-fns` + `date-fns-tz`. `Date.now()` is banned in `shared/core/` by lint rule;
time enters through an injected `Clock`.

Ukraine shifts DST on the last Sunday of March and October, so both the 18:00 flip
and the alert slot generator have explicit DST-boundary tests. This is exactly the
class of bug that costs one wrong morning a year and is never found by hand.

## Alerts

`computeAlerts({ now, assignments, settings, states })` → `{ fire[], nextWakeAt,
clearedStateIds }`, pure.

- **Slot quantization.** Alerts fire at fixed slots (18:00, 19:00, 20:00, 21:00)
  computed from an anchor — *not* "an hour after the last one". This is what makes
  restarts, sleep and clock jumps harmless: fire the current slot if
  `lastFiredAt < slotAt <= now`, never twice for the same slot.
- **Missed-slot collapsing.** Asleep from 18:00 to 23:00 fires **one** notification
  for the latest slot, not five. A burst of five is how a teenager disables
  notifications permanently.
- **Cap of 4 per evening**, then silence until 18:00 the next day. The widget keeps a
  badge regardless.
- **`armKey`** = hash(dueAt + submissionState). If a teacher moves a due date or work
  is returned for revision, a dismissed alert **re-arms**. Without this, "dismiss" is
  permanently wrong.
- **Terminal states** (`submitted` / `returned` / `graded`) silence alerts and garbage
  collect the state.
- **State is persisted before the notification is shown**, so a crash under-notifies
  rather than double-notifies.

`nextWakeAt` is returned by the pure function; the impure shell sets exactly one
`setTimeout`, clamped to ≤15 min to survive clock drift and suspend. `scheduler.ts`
is the only module permitted to call `setTimeout` / `setInterval`, enforced by lint.
Alerts are also recomputed on `powerMonitor` resume and after every sync, because
Node timers do not fire reliably across OS sleep.

## IPC

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP,
`will-navigate` and `setWindowOpenHandler` blocked.

The preload surface is derived from `shared/ipc/contract.ts` so the two cannot drift.
All arguments are validated with zod **in main** — the renderer is untrusted in
principle, and in practice this catches our own bugs. Push events use a single
`ipcRenderer.on('main:event')` demultiplexed in preload, so there is one listener
regardless of how many components subscribe.

External links go through `shell.openExternal` **only after validating the scheme is
`https:`**. Passing a provider-supplied URL straight through is a genuine hazard on
Linux via `file://` and custom schemes.

## Persistence

- **Settings** — `electron-store`, versioned with forward migrations. Contains no
  secrets, only `profileId → { source, displayName, secretKeyRef }`.
- **Cache** — behind a `CacheStore` interface, JSON first. SQLite (`better-sqlite3`)
  is deferred until the schema is stable, to avoid native-module packaging pain
  early. On encountering a *newer* cache schema version, the file is renamed to
  `.bak` and rebuilt empty — the cache is disposable by definition, and treating it
  so removes a whole class of corruption bugs.

**Cold start:** widget loads → `getSnapshot()` returns from cache in <10ms → paints
immediately marked stale → sync → repaint. A spinner is never the first frame of a
widget.

## Testing

Vitest, two projects (`node` for main and shared, `jsdom` for renderer). Playwright
`_electron` for a handful of smoke tests.

Most tests target the pure core with a `FixedClock` — the alert engine, the 18:00
flip, dedupe, and the Meet link resolver are all exhaustively table-testable. Provider
mappers are tested against captured, redacted fixtures. `SyncService` is tested with
two fake providers where one always throws, asserting the other's data still lands.

Genuinely manual: real OAuth consent, real nz.ua login and whether the WAF permits
it, notification appearance per desktop, and widget transparency / always-on-top /
click-through under Wayland vs X11.
