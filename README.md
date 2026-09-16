# classroom-nz-widget

A desktop widget for Ubuntu / Linux Mint and macOS that shows a student's **school
schedule and outstanding homework** at a glance, pulling from
[Google Classroom](https://classroom.google.com) and [nz.ua](https://nz.ua)
("Нові знання").

Built for a specific purpose: helping one schoolboy see what he needs to do, when,
and which lesson to join next — without opening two different websites.

## What it does

- **Schedule panel** — today's lessons with times, rooms and clickable Google Meet
  links. After **18:00** it flips to show *tomorrow's* schedule, so the evening is
  spent preparing for the right day. On Friday evening it skips ahead to Monday.
- **Homework panel** — overdue and upcoming assignments with due dates and
  submission state. Click any item for the full description and attachments.
- **Alerts** — if homework is missed or due, a notification fires **hourly from
  18:00**, capped at 4 per evening, resuming the next evening until it's done.
- **Settings** — accounts, refresh interval, alert cadence and quiet hours, the
  18:00 cutoff, which panels show, theme and opacity, autostart, and per-subject
  Meet link overrides.

## Status

Usable for Google Classroom homework today; the timetable arrives with nz.ua in M4.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
[docs/ROADMAP.md](docs/ROADMAP.md) for milestone detail.

To connect an account, follow [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md) first —
it needs a Google OAuth client, which takes about ten minutes to create.

| Milestone | Scope | Status |
|---|---|---|
| M1 | Widget window on screen, tray, persisted position | done |
| M2 | Google Classroom end-to-end (OAuth, homework, cache) | done |
| M3 | 18:00 schedule flip + alert engine | done |
| M4 | nz.ua timetable and homework | transport done; endpoints need discovery |
| M5 | Cross-source merge, Meet link resolver, multi-profile | done |
| M6 | Full settings, i18n (uk/en) | planned |
| M7 | Packaging, CI, release | planned |

## Development

```bash
npm install
npm run dev         # app with hot reload
npm test            # Vitest suite
npm run typecheck   # tsc --noEmit across all three build graphs
npm run lint
```

> **Note for Electron-based IDEs:** VS Code, Antigravity and similar set
> `ELECTRON_RUN_AS_NODE=1` in their integrated terminals, which makes `npm run dev`
> start plain Node instead of Electron and fail with
> `does not provide an export named 'BrowserWindow'`. Run
> `unset ELECTRON_RUN_AS_NODE` first, or use a normal terminal.

### Linux display server note

The widget relies on window transparency and always-on-top, which behave
differently under Wayland and X11. If the widget renders with an opaque or black
background on Wayland, run it forcing X11:

```bash
npm run dev -- --ozone-platform=x11
```

## Privacy

This is a personal tool. All data stays on the machine it runs on.

- OAuth tokens and any stored credentials are encrypted via Electron's
  `safeStorage`, backed by the OS keyring (GNOME Keyring / KWallet / macOS
  Keychain). They are never written to the settings file.
- The local cache stores only normalized schedule and homework data — never raw
  API responses, which contain class rosters and grades.
- Nothing is sent anywhere except to Google's and nz.ua's own APIs.
- No telemetry, no analytics, no crash reporting.

nz.ua has no public API, and it sits behind Cloudflare's interactive challenge, so
the integration drives a real browser window rather than an HTTP client. You log in
on the genuine nz.ua page — **the password never passes through this app** — and only
the session is kept. See [docs/NZ_INTEGRATION.md](docs/NZ_INTEGRATION.md). It may
break without warning if nz.ua changes; when it does, the rest of the app keeps
working and Settings says what broke.

## Licence

MIT — see [LICENSE](LICENSE).

Not affiliated with, endorsed by, or supported by Google or ТОВ «Нові знання».
