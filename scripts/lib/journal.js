// Shared by the import scripts: how rows of the old SQLite tables (from a
// database or a CSV export of it) become MongoDB documents, and how a whole
// journal is written into MongoDB.
import { collections, withTransaction } from "../../src/db/database.js";

function parseTags(json) {
  try {
    const tags = JSON.parse(json || "[]");
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch (_) {
    return [];
  }
}

// SQL NULL arrives as null (from SQLite) or "" (from a CSV export)
const isBlank = value => value == null || value === "";
const nullableNumber = value => (isBlank(value) ? null : Number(value));
const nullableText = value => (isBlank(value) ? null : String(value));

// Each source table, its target collection and how a row becomes a document
export const TABLES = [
  {
    table: "reflections",
    collection: collections.reflections,
    counter: "reflections",
    toDoc: row => ({
      id: Number(row.id),
      contestId: Number(row.contest_id),
      problemIndex: String(row.problem_index).toUpperCase(),
      problemName: row.problem_name,
      rating: nullableNumber(row.rating),
      tags: parseTags(row.tags_json),
      problemUrl: row.problem_url,
      timeSpentSeconds: Number(row.time_spent_seconds) || 0,
      keyObservation: row.key_observation,
      whatMadeMeStuck: row.what_made_me_stuck,
      stuckReason: nullableText(row.stuck_reason),
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
      index: String(row.problem_index).toUpperCase(),
      name: row.problem_name,
      rating: nullableNumber(row.rating),
      tags: parseTags(row.tags_json),
      url: row.problem_url,
      timeSpentSeconds: Number(row.time_spent_seconds) || 0,
      timerRunning: Boolean(Number(row.timer_running)),
      status: row.status || "queued",
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
      lastReviewedAt: nullableText(row.last_reviewed_at),
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

// Writes `docs` ({ table: [documents] }) into MongoDB, keeping ids and moving
// the id counters past them. Refuses when the target already has data unless
// `force`, which replaces it. All-or-nothing on a replica set (e.g. Atlas).
// Returns false (after printing why) when nothing or not everything was written.
export async function writeJournal(docs, { force = false } = {}) {
  const targetCounts = {};
  for (const { table, collection } of TABLES) targetCounts[table] = await collection.countDocuments();
  if (Object.values(targetCounts).some(n => n > 0) && !force) {
    console.error("Target already has data:", targetCounts);
    console.error("Nothing written. Re-run with --force to replace it.");
    return false;
  }

  await withTransaction(async session => {
    for (const { table, collection, counter } of TABLES) {
      const tableDocs = docs[table] || [];
      if (force) await collection.deleteMany({}, { session });
      if (tableDocs.length) await collection.insertMany(tableDocs, { session });
      if (counter) {
        // New ids continue after the imported ones
        const maxId = Math.max(0, ...tableDocs.map(doc => doc.id));
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
    const expected = (docs[table] || []).length;
    const written = await collection.countDocuments();
    ok = ok && written === expected;
    console.log(`${written === expected ? "ok " : "MISMATCH"} ${table}: ${written} of ${expected} rows`);
  }
  return ok;
}
