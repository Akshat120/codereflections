# Project state

A snapshot of where CodeReflections stands: what it is, how it's built and
deployed, what has been done, and what's still open. Update it when something
significant changes. (Last updated: October 2026.)

## What it is

A private deliberate-practice journal for competitive programming. You load a
Codeforces problem, solve it with a stopwatch running, then answer five
reflection questions (key observation, what made me stuck, pattern, future
trigger, simplest implementation). Spaced repetition brings reflections back
for review after 1, 3, 7, 14, 30, 60 and 120 days. One owner, one password.

## Stack

| Part | Choice |
|---|---|
| Runtime | Node.js 22, Express 5 (ES modules) |
| Database | MongoDB (Atlas free tier in production, local `mongod` in development) |
| Frontend | Plain HTML/CSS/JS in `public/` (no framework), KaTeX + code-prettify |
| Auth | One password, stored only as a salted scrypt hash (`APP_PASSWORD_HASH`); signed HttpOnly session cookie; failed-login lock-out |
| Hosting | Vercel (primary) and Cloudflare Workers (second deployment), same code |

## Code layout

| Path | Purpose |
|---|---|
| `src/app.js` | The Express app, shared by every entry point below |
| `src/server.js` | Local entry (`npm run dev` / `npm start`) |
| `api/index.js` | Vercel serverless entry |
| `src/entry.cloudflare.js` | Cloudflare Workers entry |
| `src/db/database.js` | MongoDB client, collections, transactions, connection errors explained |
| `src/repositories/` | Reflections, practice queue, reviews |
| `src/routes/` | REST API (`/api/problems`, `/api/reflections`, `/api/queue`, `/api/manage`, `/api/reviews`) |
| `src/services/codeforces.js` | Codeforces API client (server-side) |
| `src/auth.js`, `src/passwordHash.js`, `src/loginLimiter.js` | Login, sessions, scrypt hashing, lock-out |
| `public/` | Pages (`index.html` app, `login.html` landing + login), `app.js`, `styles.css`, icons |
| `public/_headers`, `public/_redirects` | Security headers and `/journal` redirect for Cloudflare (Vercel uses `vercel.json`) |
| `scripts/` | `copy-vendor` (build), `hash-password`, `copy-cluster`, `import-csv`, `migrate-to-mongo` |
| `docs/screenshots/` | Screenshots used in the README |

Collections: `reflections`, `practice_queue`, `review_state`, `review_log`,
`counters`, `login_attempts` (see the README's data model).

## Deployments

Both deployments run the same code from `main`, and should point at the
**same** Atlas cluster so they show the same journal (no syncing needed).

### Vercel (primary)

- Config: `vercel.json`. Build `npm run build` (copies KaTeX/prettify into
  `public/vendor`), static files from `public/`, API in region `bom1` (Mumbai).
- `/api/*` and `/health` are rewritten to `api/index.js`; pages are served by
  the CDN.
- Environment variables: `MONGODB_URI`, `APP_PASSWORD_HASH`, optional
  `MONGODB_DB`, `SESSION_SECRET`.

### Cloudflare Workers (second deployment)

- Config: `wrangler.toml`. `nodejs_compat`, build `npm run build`, static
  assets from `public/` (`/login` → `login.html`, page routes fall back to
  `index.html`); only `/api/*` and `/health` run the Worker. `CF_WORKER=1`
  tells the app it's on Workers. `keep_vars = true` stops deploys from
  deleting dashboard variables.
- Workers differences handled in code: no files on disk (the app skips its
  local static handlers), no network I/O at startup, and a MongoDB connection
  can't be shared between requests, so each request gets its own client.
- Variables: set in Worker → Settings → **Variables and Secrets** (not the
  Build variables), as type **Secret**: `MONGODB_URI`, `APP_PASSWORD_HASH`,
  optional `MONGODB_DB`, `SESSION_SECRET`. Atlas Network Access must allow
  `0.0.0.0/0`.
- Without a password set, hosted deployments send visitors to the login page,
  which shows the setup error (the API refuses every call either way).

## History (merged pull requests)

| # | Change |
|---|---|
| 1 | Moved storage to MongoDB (Atlas in production) |
| 2 | New logo |
| 3, 4 | No flash of the app before the login check |
| 5 | Faster data loading |
| 6, 7 | Manage page: pagination and per-page choice |
| 8 | Even text sizing on phones |
| 9, 19, 20, 21 | Long code and wide content scroll instead of being cut off; mobile hamburger menu |
| 10 | Database latency signal in the header |
| 11 | `copy:cluster` script to move the database between clusters |
| 12 | Vercel API region set to Mumbai (`bom1`) |
| 13 | Login page became a landing page for visitors |
| 14 | Password stored as a salted scrypt hash |
| 15 | Light/dark theme toggle on the login page |
| 16 | README screenshots |
| 17 | Footer author credit links to akshatdhiman.in |
| 22 | No per-line highlight in dark-mode code blocks |
| 23 | Cloudflare Workers deployment fixed, alongside Vercel |
| 24 | Login page shown (with the error) when no password is set |

Not merged: a demo mode, kept as work in progress on the `feature/demo-mode`
branch.

## Feature flags

Environment variables, set per deployment (`.env` locally, Vercel →
Environment Variables, Cloudflare → Variables and Secrets), then redeploy.
A flag that isn't set is **on**; `false`, `0`, `off` or `no` turns it off.
Code: `src/featureFlags.js`. Adding new reflections and problems is never
affected by any flag.

### Flag types

| Type | Prefix | When off |
|---|---|---|
| Server (allow) | `ALLOW_…` | The server refuses the request **and** the link is hidden. Protects the data. |
| Link (show) | `SHOW_…` | The link / button is only hidden; the request still works. Cosmetic. |

### Every flag

| # | Flag | Type | Category | Kind | Effect when `false` |
|---|---|---|---|---|---|
| 1 | `ALLOW_EDIT_REFLECTION` | Server | Edit | Reflection | Saving changes to an existing reflection is refused; its links hidden |
| 2 | `ALLOW_EDIT_TIME` | Server | Edit | Time and date | "Edit time" on Manage is refused; button hidden |
| 3 | `ALLOW_DELETE_PROBLEM` | Server | Delete | One problem | "Delete" on a Manage row is refused; button hidden |
| 4 | `ALLOW_DELETE_ALL` | Server | Delete | Everything | "Delete All" on Manage is refused; button hidden |
| 5 | `SHOW_EDIT_REFLECTION` | Link | Edit | Reflection | Hides "Edit" on a saved reflection, "Edit reflection" on Manage; dashboard problem names become plain text |
| 6 | `SHOW_EDIT_TIME` | Link | Edit | Time and date | Hides "Edit time" on Manage |
| 7 | `SHOW_DELETE_PROBLEM` | Link | Delete | One problem | Hides "Delete" on Manage rows |
| 8 | `SHOW_DELETE_ALL` | Link | Delete | Everything | Hides "Delete All" on Manage |

### Group flags

| # | Flag | Type | Same as setting `false` |
|---|---|---|---|
| 9 | `ALLOW_EDITS` | Server | `ALLOW_EDIT_REFLECTION`, `ALLOW_EDIT_TIME` |
| 10 | `ALLOW_DELETES` | Server | `ALLOW_DELETE_PROBLEM`, `ALLOW_DELETE_ALL` |
| 11 | `SHOW_EDIT_LINKS` | Link | `SHOW_EDIT_REFLECTION`, `SHOW_EDIT_TIME` |
| 12 | `SHOW_DELETE_LINKS` | Link | `SHOW_DELETE_PROBLEM`, `SHOW_DELETE_ALL` |

### How they combine

- An action is allowed only if its own `ALLOW_` flag **and** its group flag
  are on.
- A link is shown only if the action is allowed **and** its own `SHOW_` flag
  **and** its group `SHOW_` flag are on.

### Common setups

| Goal | Set |
|---|---|
| Normal (default) | nothing |
| Guard against wiping everything | `ALLOW_DELETE_ALL=false` |
| No deletes at all | `ALLOW_DELETES=false` |
| Add-only journal (no edits, no deletes) | `ALLOW_EDITS=false`, `ALLOW_DELETES=false` |
| Cleaner screen, everything still works | `SHOW_EDIT_LINKS=false`, `SHOW_DELETE_LINKS=false` |
| Lock Cloudflare, keep Vercel editable | set the `ALLOW_` flags on Cloudflare only |

## Open items

- **Cloudflare database connection**: confirm the Worker reaches Atlas once the
  secrets are set. If it fails with a `querySrv` error, switch the Worker to the
  long `mongodb://host1,host2,host3/...` form of the connection string.
- **Cloudflare latency**: each API request opens a new Atlas connection there,
  so it's slower than Vercel; expected, not a bug.
- **Demo mode**: parked on `feature/demo-mode`.

## Handy commands

```bash
npm run dev                 # local server with reload (needs a local mongod or MONGODB_URI)
npm run build               # copy KaTeX / prettify into public/vendor
npm run hash-password       # make APP_PASSWORD_HASH
npm run copy:cluster        # copy the database to another cluster (backs up first)
npx wrangler@4 dev          # run the Cloudflare Worker locally (secrets in .dev.vars)
```

Never commit `.env`, `.dev.vars`, connection strings, password hashes or
`backups/` (all git-ignored).
