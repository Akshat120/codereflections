import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Turso in production (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN); a local SQLite
// file otherwise, so development keeps using data/reflection.db as before.
// A missing URL on Vercel is reported by dbReady() on every API call (instead
// of crashing the function), and no query ever runs.
let configError = null;

function databaseUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  if (process.env.VERCEL) {
    configError = "TURSO_DATABASE_URL is not set. Add it in the Vercel project settings.";
    return "file::memory:";
  }
  const dataDir = path.join(__dirname, "../../data");
  fs.mkdirSync(dataDir, { recursive: true });
  return `file:${path.join(dataDir, "reflection.db")}`;
}

export const db = createClient({
  url: databaseUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN
});

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS reflections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contest_id INTEGER NOT NULL,
      problem_index TEXT NOT NULL,
      problem_name TEXT NOT NULL,
      rating INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      problem_url TEXT NOT NULL,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      key_observation TEXT NOT NULL,
      what_made_me_stuck TEXT NOT NULL,
      pattern TEXT NOT NULL,
      future_trigger TEXT NOT NULL,
      simplest_implementation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(contest_id, problem_index)
    );

    CREATE TABLE IF NOT EXISTS practice_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contest_id INTEGER NOT NULL,
      problem_index TEXT NOT NULL,
      problem_name TEXT NOT NULL,
      rating INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      problem_url TEXT NOT NULL,
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      timer_running INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      added_at TEXT NOT NULL,
      UNIQUE(contest_id, problem_index)
    );

    -- Spaced-repetition state per reflection. A reflection without a row here
    -- has never been reviewed and is first due one day after it was solved.
    CREATE TABLE IF NOT EXISTS review_state (
      reflection_id INTEGER PRIMARY KEY,
      stage INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL,
      last_reviewed_at TEXT,
      reviews INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reflection_id INTEGER NOT NULL,
      grade TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );
  `);

  // Added after the first release: why the problem got you stuck (optional)
  const columns = await db.execute(`PRAGMA table_info(reflections)`);
  if (!columns.rows.some(column => column.name === "stuck_reason")) {
    await db.execute(`ALTER TABLE reflections ADD COLUMN stuck_reason TEXT`);
  }
}

// Resolves once the schema is ready; every request waits on it (cold starts on
// Vercel run initDb once per instance).
let ready;
export function dbReady() {
  if (configError) return Promise.reject(new Error(configError));
  if (!ready) {
    ready = initDb().catch(error => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}
