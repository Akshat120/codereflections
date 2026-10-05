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

Per kind of edit / delete, each with a server flag (`ALLOW_…`, refuses the
request and hides the link) and a link flag (`SHOW_…`, hides only):
edit reflection, edit time, delete one problem, delete all. Group flags
`ALLOW_EDITS`, `ALLOW_DELETES`, `SHOW_EDIT_LINKS`, `SHOW_DELETE_LINKS` cover a
whole type. All on by default; environment variables, set per deployment.
Full table in the README's Feature flags section; code in
`src/featureFlags.js`.

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
