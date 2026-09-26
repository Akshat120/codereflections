// One-time copy of a SQLite journal (the old local data/reflection.db, or a
// Turso database) into MongoDB.
//
//   MONGODB_URI="mongodb+srv://..." npm run migrate:mongo
//
// Copies every reflection, queued problem and review record with its original
// id (so review history and "recently written" order survive), and sets the id
// counters past them. On a replica set (e.g. Atlas) the copy is all-or-nothing.
// Refuses to touch a target that already has data unless run with --force,
// which replaces the target's data with the copied journal.
//
// Source: SOURCE_DATABASE_URL (default file:data/reflection.db); for Turso use
// SOURCE_DATABASE_URL=libsql://... and SOURCE_AUTH_TOKEN=...
// Target: MONGODB_URI (default mongodb://127.0.0.1:27017) and MONGODB_DB.
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { client, collections, initDb, withTransaction } from "../src/db/database.js";

const force = process.argv.includes("--force");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceUrl = process.env.SOURCE_DATABASE_URL || `file:${path.join(root, "data/reflection.db")}`;

// Opening a missing file would silently create an empty database and "copy"
// nothing, so a local source must already exist.
if (sourceUrl.startsWith("file:") && !fs.existsSync(sourceUrl.slice("file:".length))) {
  console.error(`Source database not found: ${sourceUrl}`);
  console.error("Set SOURCE_DATABASE_URL=file:/path/to/data/reflection.db (or a libsql:// Turso URL).");
  process.exit(1);
}

const source = createClient({ url: sourceUrl, authToken: process.env.SOURCE_AUTH_TOKEN });

function parseTags(json) {
  try {
    const tags = JSON.parse(json || "[]");
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch (_) {
    return [];
  }
}

const nullableNumber = value => (value == null ? null : Number(value));

// Each source table, its target collection and how a row becomes a document
const TABLES = [
  {
    table: "reflections",
    collection: collections.reflections,
    counter: "reflections",
    toDoc: row => ({
      id: Number(row.id),
      contestId: Number(row.contest_id),
      problemIndex: row.problem_index,
      problemName: row.problem_name,
      rating: nullableNumber(row.rating),
      tags: parseTags(row.tags_json),
      problemUrl: row.problem_url,
      timeSpentSeconds: Number(row.time_spent_seconds) || 0,
      keyObservation: row.key_observation,
      whatMadeMeStuck: row.what_made_me_stuck,
      stuckReason: row.stuck_reason ?? null,
      pattern: row.pattern,
      futureTrigger: row.future_trigger,
      simplestImplementation: row.simplest_implementation,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  },
  {
    table: "practice_queue",
    collection: collections.queue,
    counter: "practice_queue",
    toDoc: row => ({
      id: Number(row.id),
      contestId: Number(row.contest_id),
      index: row.problem_index,
      name: row.problem_name,
      rating: nullableNumber(row.rating),
      tags: parseTags(row.tags_json),
      url: row.problem_url,
      timeSpentSeconds: Number(row.time_spent_seconds) || 0,
      timerRunning: Boolean(Number(row.timer_running)),
      status: row.status,
      addedAt: row.added_at
    })
  },
  {
    table: "review_state",
    collection: collections.reviewState,
    toDoc: row => ({
      reflectionId: Number(row.reflection_id),
      stage: Number(row.stage),
      dueAt: row.due_at,
      lastReviewedAt: row.last_reviewed_at ?? null,
      reviews: Number(row.reviews),
      lapses: Number(row.lapses)
    })
  },
  {
    table: "review_log",
    collection: collections.reviewLog,
    toDoc: row => ({
      reflectionId: Number(row.reflection_id),
      grade: row.grade,
      reviewedAt: row.reviewed_at
    })
  }
];

async function tableExists(table) {
  const result = await source.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table]
  });
  return result.rows.length > 0;
}

async function main() {
  console.log(`Source: ${sourceUrl}`);
  console.log(`Target: MongoDB database "${collections.reflections.dbName}"`);

  // Connects and creates the collections' indexes (no data yet)
  await initDb();

  const targetCounts = {};
  for (const { table, collection } of TABLES) targetCounts[table] = await collection.countDocuments();
  if (Object.values(targetCounts).some(n => n > 0) && !force) {
    console.error("Target already has data:", targetCounts);
    console.error("Nothing copied. Re-run with --force to replace it with the source journal.");
    process.exit(1);
  }

  const docs = {};
  for (const { table, toDoc } of TABLES) {
    docs[table] = (await tableExists(table))
      ? (await source.execute(`SELECT * FROM ${table} ORDER BY rowid`)).rows.map(toDoc)
      : [];
  }
  if (docs.reflections.length === 0) {
    console.error("The source has no reflections; refusing to copy an empty journal.");
    process.exit(1);
  }

  await withTransaction(async session => {
    for (const { table, collection, counter } of TABLES) {
      if (force) await collection.deleteMany({}, { session });
      if (docs[table].length) await collection.insertMany(docs[table], { session });
      if (counter) {
        // New ids continue after the copied ones
        const maxId = Math.max(0, ...docs[table].map(doc => doc.id));
        await collections.counters.updateOne(
          { _id: counter },
          { $max: { seq: maxId } },
          { upsert: true, session }
        );
      }
    }
  });

  let ok = true;
  for (const { table, collection } of TABLES) {
    const copied = await collection.countDocuments();
    const match = copied === docs[table].length;
    ok = ok && match;
    console.log(`${match ? "ok " : "MISMATCH"} ${table}: ${copied} of ${docs[table].length} rows`);
  }
  if (!ok) process.exitCode = 1;
  else console.log("Done. Your journal is in MongoDB.");
}

main()
  .catch(error => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
