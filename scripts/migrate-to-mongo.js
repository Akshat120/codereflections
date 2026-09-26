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

import { client, collections, initDb } from "../src/db/database.js";
import { TABLES, writeJournal } from "./lib/journal.js";

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

  const docs = {};
  for (const { table, toDoc } of TABLES) {
    docs[table] = (await tableExists(table))
      ? (await source.execute(`SELECT * FROM ${table} ORDER BY rowid`)).rows.map(toDoc)
      : [];
  }
  if (docs.reflections.length === 0) {
    console.error("The source has no reflections; refusing to copy an empty journal.");
    process.exitCode = 1;
    return;
  }

  if (await writeJournal(docs, { force })) console.log("Done. Your journal is in MongoDB.");
  else process.exitCode = 1;
}

main()
  .catch(error => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
