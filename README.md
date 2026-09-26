# Problem Reflection

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
  └── SQLite repository
```

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
