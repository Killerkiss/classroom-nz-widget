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

`NzTransport` and its three implementations, endpoints, zod schemas, capability
probe, fixture recorder, circuit breaker and rate limiter, health UI and stale
banner. The timetable panel becomes real.

*Demo: the real bell schedule with rooms; kill the network and the widget still
renders from cache with an amber dot.*

## M5 — Merge, Meet links, multi-profile

Cross-source dedupe with a confirmation UI, Google Calendar `conferenceData` client,
the Meet link resolver chain with per-subject overrides, parent/student profile
switching, source badges and provenance in the detail panel. JSON cache → SQLite.

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
