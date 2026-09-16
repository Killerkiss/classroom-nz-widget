# Roadmap

Each milestone ends in something runnable and demoable. M2 alone is already a useful
daily tool — that ordering is deliberate, because M4 (nz.ua) carries the only
unbounded risk in the project and nothing valuable should depend on it.

## M1 — A real widget on screen

Scaffold, domain models, frameless / transparent / always-on-top / skip-taskbar
widget rendering **fixture data**. Tray icon. Window position persisted and clamped
to a visible display. `contextBridge` wiring proven end to end.

**First task of all:** verify transparency and always-on-top on the actual target
Linux session. Wayland and X11 differ here, and this needs to be known on day one.

*Demo: a widget floating on the desktop that survives a restart in the same place.*

## M2 — Google Classroom end to end

OAuth loopback + PKCE, `SafeStorageSecretStore` with Linux backend detection,
`GoogleClassroomProvider` + mappers, `SyncService`, JSON `CacheStore`,
`settingsStore`. Real homework panel with detail drawer and "Open in Classroom".

*Demo: real homework on screen, surviving restart, still rendering offline.*

## M3 — The 18:00 flip and the alert engine

`selectScheduleDay` and `computeAlerts` as pure functions with an injected clock,
with the full unit suite including DST boundaries. `AlertService`, `alertStore`,
`scheduler.ts`, notifications, snooze / dismiss / done, `powerMonitor` resync.

*Demo: set the flip hour two minutes out and watch the panel flip; set homework due
tomorrow and watch it ping hourly, stop at four, and stop entirely on snooze; restart
and confirm it does not re-fire.*

## M4 — nz.ua

**Partly done.** The transport, request pacing, error classification and health
plumbing are built and tested. `BrowserSessionTransport` is the primary transport
rather than a fallback, because nz.ua returns Cloudflare's interactive challenge
(`cf-mitigated: challenge`) to every HTTP client.

**Blocked on discovery.** The endpoint paths cannot be observed from outside a
logged-in browser, so `endpoints.ts` ships empty and is filled from a recording run
on the user's own machine — see [NZ_INTEGRATION.md](NZ_INTEGRATION.md). Until then
`capabilities()` is empty, so the UI reports that there is no timetable source
rather than showing an empty timetable.

Remaining once the endpoints are known: zod schemas, mappers, fixtures, and the real
timetable panel.

*Demo: the real bell schedule with rooms; kill the network and the widget still
renders from cache with an amber dot.*

## M5 — Merge, Meet links, multi-profile

**Done, apart from the UI surfaces.** Three-tier dedupe, the field-precedence table
with provenance, the Google Calendar `conferenceData` client, and the Meet resolver
chain are all built and tested.

Remaining: the confirmation UI for weak duplicate suggestions, per-subject override
editing in Settings, source badges in the detail panel, and the JSON cache → SQLite
swap now that the schema has settled.

*Demo: one homework item shown once carrying both source badges; clicking a lesson
opens Meet.*

## M6 — Settings and polish

Every setting wired: refresh interval, alert cadence, quiet hours, panel visibility,
theme and opacity, autostart on both OSes, the flip hour, subject aliases, transport
override, secret-backend warning. i18n uk/en. Click-through toggle. Empty and error
states.

## M7 — Ship

electron-builder targets (AppImage + deb, dmg arm64 and x64), CI matrix, release
workflow, Playwright smokes, diagnostics export, and a README covering the macOS
Gatekeeper quarantine step and the AppImage `libfuse2` requirement.

