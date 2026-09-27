// Imports a CSV export of the old SQLite journal into MongoDB.
//
//   MONGODB_URI="mongodb+srv://..." npm run import:csv -- path/to/*.csv
//
// Pass one CSV per table; the table is taken from the file name, which must
// end in reflections.csv, practice_queue.csv, review_state.csv or
// review_log.csv (a prefix like "c1411c52-reflections.csv" is fine). Missing or
// empty files import as empty tables. Header row required; empty fields are
// read as NULL.
//
// Keeps every original id (so links, review history and ordering survive) and
// moves the id counters past them. Refuses to touch a target that already has
// data unless run with --force, which replaces it. --dry-run checks the files
// and prints what would be written without connecting to MongoDB.
import fs from "node:fs";
import path from "node:path";

import { client, collections, initDb } from "../src/db/database.js";
import { STUCK_REASON_KEYS } from "../src/stuckReasons.js";
import { TABLES, writeJournal } from "./lib/journal.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const files = args.filter(arg => !arg.startsWith("--"));

// RFC 4180 CSV: quoted fields may hold commas, newlines and "" (a quote).
// Returns one object per data row, keyed by the header row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    row.push(field === "" && !wasQuoted ? null : field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] != null) rows.push(row);
    row = [];
  };

  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n" || (char === "\r" && text[i + 1] === "\n")) {
      if (char === "\r") i++;
      endRow();
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("unterminated quoted field");
  if (field !== "" || wasQuoted || row.length) endRow();

  if (!rows.length) return [];
  const [header, ...data] = rows;
  return data.map((values, n) => {
    if (values.length !== header.length) {
      throw new Error(`row ${n + 2} has ${values.length} fields, the header has ${header.length}`);
    }
    // "" in the file means SQL NULL
    return Object.fromEntries(header.map((name, i) => [name, values[i] === "" ? null : values[i]]));
  });
}

function tableForFile(file) {
  const name = path.basename(file).toLowerCase();
  return TABLES.find(({ table }) => name.endsWith(`${table}.csv`))?.table;
}

// Problems that would make the journal inconsistent (duplicate ids, reviews of
// missing reflections); returns a list of messages, empty when all is well.
function check(docs) {
  const problems = [];
  const duplicates = (list, keyOf, what) => {
    const seen = new Set();
    for (const doc of list) {
      const key = keyOf(doc);
      if (seen.has(key)) problems.push(`duplicate ${what}: ${key}`);
      seen.add(key);
    }
  };
  duplicates(docs.reflections, doc => doc.id, "reflection id");
  duplicates(docs.reflections, doc => `${doc.contestId}${doc.problemIndex}`, "reflection for problem");
  duplicates(docs.practice_queue, doc => doc.id, "queue id");
  duplicates(docs.practice_queue, doc => `${doc.contestId}${doc.index}`, "queued problem");
  duplicates(docs.review_state, doc => doc.reflectionId, "review_state for reflection");

  for (const doc of [...docs.reflections, ...docs.practice_queue]) {
    if (!Number.isInteger(doc.id) || !Number.isInteger(doc.contestId)) {
      problems.push(`bad id or contest id in row ${JSON.stringify({ id: doc.id, contestId: doc.contestId })}`);
    }
  }
  const reflectionIds = new Set(docs.reflections.map(doc => doc.id));
  for (const doc of [...docs.review_state, ...docs.review_log]) {
    if (!reflectionIds.has(doc.reflectionId)) problems.push(`review data for missing reflection ${doc.reflectionId}`);
  }
  for (const doc of docs.reflections) {
    if (doc.stuckReason && !STUCK_REASON_KEYS.has(doc.stuckReason)) {
      problems.push(`reflection ${doc.id} has unknown stuck reason "${doc.stuckReason}"`);
    }
  }
  return problems;
}

async function main() {
  if (!files.length) {
    console.error("Usage: npm run import:csv -- [--dry-run] [--force] <table>.csv ...");
    process.exitCode = 1;
    return;
  }

  const docs = Object.fromEntries(TABLES.map(({ table }) => [table, []]));
  for (const file of files) {
    const table = tableForFile(file);
    if (!table) throw new Error(`${file}: name must end in one of ${TABLES.map(t => `${t.table}.csv`).join(", ")}`);
    let rows;
    try {
      rows = parseCsv(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
    docs[table] = rows.map(TABLES.find(t => t.table === table).toDoc);
    console.log(`Read ${file}: ${rows.length} ${table} rows`);
  }

  const problems = check(docs);
  if (problems.length) {
    console.error("Not importing; the files have problems:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (docs.reflections.length === 0) {
    console.error("No reflections to import; refusing to write an empty journal.");
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log("Dry run: files look good. Would write:");
    for (const { table } of TABLES) console.log(`  ${table}: ${docs[table].length}`);
    return;
  }

  console.log(`Target: MongoDB database "${collections.reflections.dbName}"`);
  await initDb({ waitForIndexes: true });
  if (await writeJournal(docs, { force })) console.log("Done. Your journal is in MongoDB.");
  else process.exitCode = 1;
}

main()
  .catch(error => {
    console.error("Import failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
