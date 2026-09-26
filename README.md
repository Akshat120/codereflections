# Problem Reflection

A Node.js + Express monolith that helps competitive programmers turn each difficult Codeforces problem into reusable knowledge.

## Workflow

1. Paste a Codeforces problem URL.
2. The server fetches problem metadata (name, rating, tags, contest ID, index).
3. Solve the problem while the app tracks time spent.
4. Fill out five mandatory post-solve reflection questions on one page.
5. Save the reflection to MongoDB.
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
  └── MongoDB repositories (local mongod, or MongoDB Atlas in production)
```

## Run locally

You need a MongoDB server: install [MongoDB Community](https://www.mongodb.com/docs/manual/installation/), run it in Docker (`docker run -d -p 27017:27017 mongo:7`), or point `MONGODB_URI` at a free Atlas cluster.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Locally the app connects to `mongodb://127.0.0.1:27017`, uses the `codereflections` database, and needs no login.

Optional environment variables:

| Variable | Effect |
|---|---|
| `MONGODB_URI` | MongoDB connection string (default `mongodb://127.0.0.1:27017`; required on Vercel) |
| `MONGODB_DB` | Database name (default `codereflections`) |
| `APP_PASSWORD` | Require this password to use the app (always required on Vercel) |
| `SESSION_SECRET` | Key for signing login cookies (defaults to one derived from `APP_PASSWORD`) |

### Data model

| Collection | Contents |
|---|---|
| `reflections` | One document per solved problem, unique on `(contestId, problemIndex)`, with an integer `id` |
| `practice_queue` | Problems waiting to be solved, unique on `(contestId, index)`, ordered by integer `id` |
| `review_state` | Spaced-repetition state per reflection (`reflectionId`) |
| `review_log` | Every review grade given |
| `counters` | Next integer id for `reflections` and `practice_queue` |

Writes that touch several collections (deleting a problem, recording a review, adding several problems to the queue) run in a transaction on a replica set or Atlas cluster. A standalone `mongod` has no transactions, so there they run one after another.

## Deploy to Vercel + MongoDB Atlas (free)

1. **Create the database**: create a free (M0) cluster in [MongoDB Atlas](https://www.mongodb.com/cloud/atlas), add a database user, and allow access from anywhere (`0.0.0.0/0`, since Vercel functions have no fixed IP). Copy the connection string (`mongodb+srv://...`).
2. **Copy your old journal into it** (optional; from the local `data/reflection.db` SQLite file or a Turso database, keeping ids and review history):
   ```bash
   MONGODB_URI="mongodb+srv://..." npm run migrate:mongo
   # from Turso instead of the local file:
   SOURCE_DATABASE_URL="libsql://..." SOURCE_AUTH_TOKEN="..." MONGODB_URI="mongodb+srv://..." npm run migrate:mongo
   ```
   Or from a CSV export of the tables (one file per table, named `…reflections.csv`, `…practice_queue.csv`, `…review_state.csv`, `…review_log.csv`):
   ```bash
   MONGODB_URI="mongodb+srv://..." npm run import:csv -- --dry-run exports/*.csv   # check the files only
   MONGODB_URI="mongodb+srv://..." npm run import:csv -- exports/*.csv
   ```
   Both refuse to write into a database that already has data; add `--force` to replace it.
3. **Deploy**: import the repository in Vercel (framework preset "Other"; `vercel.json` sets the build) and add these environment variables:
   - `MONGODB_URI`: from step 1 (and `MONGODB_DB` if you don't use the default name)
   - `APP_PASSWORD`: the password you'll log in with (the API refuses to run on Vercel without it)
4. Open the site, log in, done.

`vercel.json` runs the API in Vercel's Dublin region (`dub1`); create the Atlas cluster in a nearby region (e.g. AWS `eu-west-1`, Ireland) or change `regions`.

How it runs on Vercel: `public/` is served by the CDN (`npm run build` copies KaTeX and Prettify into `public/vendor/`), and every `/api/*` request goes to one serverless function (`api/index.js`) running the same Express app as locally. Warm invocations reuse one MongoDB connection pool.

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
