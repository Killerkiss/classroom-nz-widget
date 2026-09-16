# Setting up Google Classroom access

The app talks to Google Classroom on your son's behalf, which needs an OAuth client
you create once in Google Cloud. It is free, takes about ten minutes, and nothing
leaves your machine.

## 1. Create a project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Create a new project — call it anything, e.g. `classroom-nz-widget`.

## 2. Enable the APIs

Under **APIs & Services → Library**, enable both:

- **Google Classroom API**
- **Google Calendar API** (used later to find Meet links attached to lessons)

## 3. Configure the consent screen

Under **APIs & Services → OAuth consent screen**:

- **User type:** External
- Fill in the app name, your email as support contact, and your email as developer
  contact. Nothing else is required.

### Add the scopes

Add these five, all read-only:

```
.../auth/classroom.courses.readonly
.../auth/classroom.coursework.me.readonly
.../auth/classroom.student-submissions.me.readonly
.../auth/classroom.announcements.readonly
.../auth/calendar.events.readonly
```

The app never requests a write scope. "Mark as done" is stored locally — it silences
alerts without needing permission to change anything in Classroom.

### Publish it — this part matters

Set the publishing status to **"In production"**. Do **not** leave it in "Testing".

> **Why:** while an app is in "Testing", Google revokes its refresh tokens after
> **7 days**. Your son would have to sign in again every week. Publishing to
> production removes that expiry.

You do **not** need to complete Google's verification review. An unverified
production app works fine; the only consequences are:

- A one-time **"Google hasn't verified this app"** screen on first sign-in. Click
  **Advanced → Go to (app name)**.
- A lifetime cap of 100 users, which is irrelevant for a family tool.

## 4. Create the OAuth client

Under **APIs & Services → Credentials → Create Credentials → OAuth client ID**:

- **Application type: Desktop app**

Copy the **client ID** and **client secret**.

> For a desktop app the client secret is not actually secret — by Google's own
> definition it ships inside the binary. The flow is protected by PKCE, not by
> keeping the secret hidden. Still, don't commit it to a public repo.

## 5. Give the app the credentials

Create a `.env` file (it is gitignored). Where it goes depends on how you run the app:

- **Running from source:** the project root.
- **Installed build:** your app data directory —
  `~/.config/classroom-nz-widget/.env` on Linux, or
  `~/Library/Application Support/classroom-nz-widget/.env` on macOS.

The file looks like this:

```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
```

Then start the app and use **Settings → Accounts → Підключити**. A browser window
opens, your son signs in, and the app receives a refresh token which is stored
encrypted in the system keyring.

## 6. Which account to sign in with

Sign in as **the student**. The scopes are `.me` scopes — they return that user's own
coursework and submissions. A parent account sees nothing useful in Classroom.

## If the school blocks it

Many schools run Google Workspace for Education with third-party app access
restricted. If sign-in fails with "access blocked" or "admin has disabled", the
school's Workspace admin has to allow the app's client ID. There is no way around
this from the app's side, and it is worth checking before spending time on setup.

## Troubleshooting

**"No Google OAuth client is configured"** — the `.env` file is missing or was not
loaded. Check it is in the location listed in step 5 and restart the app; the log
line on startup says which path was used, or where it looked.

**"Google did not return a refresh token"** — the account previously authorized this
app, so Google skipped issuing a new one. Remove the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
sign in again.

**Signed out after 7 days** — the consent screen is still in "Testing". See step 3.
