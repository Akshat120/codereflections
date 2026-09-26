<p align="center">
  <img src="public/logo.svg" alt="CodeReflections logo" width="96" height="96">
</p>

<h1 align="center">CodeReflections</h1>

<p align="center"><b>Deliberate Practice Journal</b>: turn every hard Codeforces problem into a lesson.</p>

A Node.js + Express monolith that helps competitive programmers turn each difficult Codeforces problem into reusable knowledge.

## Workflow

1. Paste a Codeforces problem URL.
2. The server fetches problem metadata (name, rating, tags, contest ID, index).
3. Solve the problem while the app tracks time spent.
4. Fill out five mandatory post-solve reflection questions on one page.
5. Save the reflection to SQLite.
6. Review completed problems from your personal journal.

## Architecture

```
Browser
  ↓
Express server
  ├── HTML/CSS/JS (public/)
  ├── REST API
  │    ├── GET /api/problems/:contestId/:index
  │    └── /api/reflections
  ├── Codeforces API client (server-side only)
  └── SQLite repository (local file, or Turso in production)
```

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Locally the app stores everything in `data/reflection.db` (a SQLite file) and needs no login.

Optional environment variables:

| Variable | Effect |
|---|---|
| `APP_PASSWORD` | Require this password to use the app (always required on Vercel) |
| `SESSION_SECRET` | Key for signing login cookies (defaults to one derived from `APP_PASSWORD`) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Use a Turso database instead of the local file |

## Deploy to Vercel + Turso (free)

1. **Create the database** (install the [Turso CLI](https://docs.turso.tech/cli/installation) and log in):
   ```bash
   turso db create codereflections
   turso db show codereflections --url
   turso db tokens create codereflections
   ```
2. **Copy your journal into it** (reflections, queue and review history, keeping ids):
   ```bash
   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run migrate:turso
   ```
   It refuses to write into a database that already has data; add `--force` to replace it.
3. **Deploy**: import the repository in Vercel (framework preset "Other"; `vercel.json` sets the build) and add these environment variables:
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`: from step 1
   - `APP_PASSWORD`: the password you'll log in with (the API refuses to run on Vercel without it)
4. Open the site, log in, done.

`vercel.json` runs the API in Vercel's Dublin region (`dub1`) to sit next to a Turso database in `aws-eu-west-1`; change `regions` if you create the database elsewhere.

How it runs on Vercel: `public/` is served by the CDN (`npm run build` copies KaTeX and Prettify into `public/vendor/`), and every `/api/*` request goes to one serverless function (`api/index.js`) running the same Express app as locally.

## API

### Get problem metadata

`GET /api/problems/2263/B`

### List reflections

`GET /api/reflections`

### Get one reflection

`GET /api/reflections/2263/B`

### Create or update reflection

`POST /api/reflections`

### Health check

`GET /health` → `{ "status": "ok" }`

## Design

The UI follows the visual language of Codeforces: white background, thin borders, compact panels, blue section headings, dense tables, and a main content + right sidebar layout. It is a practice journal, not a modern SaaS dashboard.
