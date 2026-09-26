// One-time copy of the local journal (data/reflection.db) into Turso.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run migrate:turso
//
// Copies every row of every table with its original id (so review history and
// "recently written" order survive) in a single all-or-nothing batch. Refuses
// to touch a target that already has data unless run with --force, which
// replaces the target's data with the local copy.
//
// Optional: SOURCE_DATABASE_URL (default file:data/reflection.db).
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db as target, initDb } from "../src/db/database.js";

const TABLES = ["reflections", "practice_queue", "review_state", "review_log"];
const force = process.argv.includes("--force");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceUrl = process.env.SOURCE_DATABASE_URL || `file:${path.join(root, "data/reflection.db")}`;

if (!process.env.TURSO_DATABASE_URL) {
  console.error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) to the Turso database to copy into.");
  process.exit(1);
}
if (process.env.TURSO_DATABASE_URL === sourceUrl) {
  console.error("Source and target are the same database.");
  process.exit(1);
}

// Opening a missing file would silently create an empty database and "copy"
// nothing, so a local source must already exist.
if (sourceUrl.startsWith("file:") && !fs.existsSync(sourceUrl.slice("file:".length))) {
  console.error(`Source database not found: ${sourceUrl}`);
  console.error("Set SOURCE_DATABASE_URL=file:/path/to/data/reflection.db");
  process.exit(1);
}

const source = createClient({ url: sourceUrl });

async function tableExists(client, table) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table]
  });
  return result.rows.length > 0;
}

async function count(client, table) {
  return Number((await client.execute(`SELECT count(*) AS c FROM ${table}`)).rows[0].c);
}

async function main() {
  console.log(`Source: ${sourceUrl}`);
  console.log(`Target: ${process.env.TURSO_DATABASE_URL}`);

  // Create the tables on the target (the schema only; no data yet). Columns
  // the source lacks (e.g. an old journal without stuck_reason) stay empty.
  await initDb();

  const targetCounts = {};
  for (const table of TABLES) targetCounts[table] = await count(target, table);
  const targetHasData = Object.values(targetCounts).some(n => n > 0);
  if (targetHasData && !force) {
    console.error("Target already has data:", targetCounts);
    console.error("Nothing copied. Re-run with --force to replace it with your local journal.");
    process.exit(1);
  }

  const targetColumns = {};
  for (const table of TABLES) {
    const info = await target.execute(`PRAGMA table_info(${table})`);
    targetColumns[table] = new Set(info.rows.map(row => row.name));
  }

  const statements = [];
  if (force) {
    for (const table of TABLES) statements.push(`DELETE FROM ${table}`);
  }

  if (!(await tableExists(source, "reflections")) || (await count(source, "reflections")) === 0) {
    console.error("The source has no reflections; refusing to copy an empty journal.");
    process.exit(1);
  }

  const sourceCounts = {};
  for (const table of TABLES) {
    if (!(await tableExists(source, table))) {
      sourceCounts[table] = 0;
      continue;
    }
    const rows = (await source.execute(`SELECT * FROM ${table}`)).rows;
    sourceCounts[table] = rows.length;
    for (const row of rows) {
      const columns = Object.keys(row).filter(column => targetColumns[table].has(column));
      statements.push({
        sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        args: columns.map(column => row[column])
      });
    }
  }

  await target.batch(statements, "write");

  let ok = true;
  for (const table of TABLES) {
    const copied = await count(target, table);
    const match = copied === sourceCounts[table];
    ok = ok && match;
    console.log(`${match ? "ok " : "MISMATCH"} ${table}: ${copied} of ${sourceCounts[table]} rows`);
  }
  if (!ok) process.exit(1);
  console.log("Done. Your journal is in Turso.");
}

main().catch(error => {
  console.error("Migration failed; no journal data was copied:", error.message);
  process.exit(1);
});
