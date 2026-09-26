import { db } from "../db/database.js";

// Days until the next review, indexed by stage. "Remembered" moves a
// reflection one stage further out; "forgot" sends it back to stage 0.
export const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120];
export const GRADES = ["forgot", "hard", "remembered"];

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

function mapRow(row) {
  const stage = row.stage ?? 0;
  return {
    reflectionId: row.id,
    contestId: row.contest_id,
    index: row.problem_index,
    stage,
    intervalDays: INTERVAL_DAYS[stage],
    // Never reviewed: first due one day after the problem was solved
    dueAt: row.due_at ?? addDays(new Date(row.created_at), INTERVAL_DAYS[0]),
    lastReviewedAt: row.last_reviewed_at ?? null,
    reviews: row.reviews ?? 0,
    lapses: row.lapses ?? 0
  };
}

const selectStates = `
  SELECT r.id, r.contest_id, r.problem_index, r.created_at,
         s.stage, s.due_at, s.last_reviewed_at, s.reviews, s.lapses
  FROM reflections r
  LEFT JOIN review_state s ON s.reflection_id = r.id
`;

export async function findAllReviewStates() {
  const result = await db.execute(selectStates);
  return result.rows.map(mapRow);
}

export async function findReviewState(reflectionId) {
  const result = await db.execute({ sql: `${selectStates} WHERE r.id = ?`, args: [reflectionId] });
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Next state for a grade, from the current one.
export function nextState(current, grade, now = new Date()) {
  let stage = current.stage;
  let days;

  if (grade === "remembered") {
    stage = Math.min(stage + 1, INTERVAL_DAYS.length - 1);
    days = INTERVAL_DAYS[stage];
  } else if (grade === "hard") {
    days = Math.max(1, Math.round(INTERVAL_DAYS[stage] / 2));
  } else {
    stage = 0;
    days = INTERVAL_DAYS[0];
  }

  return {
    stage,
    dueAt: addDays(now, days),
    lastReviewedAt: now.toISOString(),
    reviews: current.reviews + 1,
    lapses: current.lapses + (grade === "forgot" ? 1 : 0)
  };
}

export async function recordReview(reflectionId, grade) {
  const current = await findReviewState(reflectionId);
  if (!current) return null;

  const next = nextState(current, grade);

  // State and log are written together or not at all
  await db.batch([
    {
      sql: `
        INSERT INTO review_state (reflection_id, stage, due_at, last_reviewed_at, reviews, lapses)
        VALUES (:reflectionId, :stage, :dueAt, :lastReviewedAt, :reviews, :lapses)
        ON CONFLICT(reflection_id) DO UPDATE SET
          stage = excluded.stage,
          due_at = excluded.due_at,
          last_reviewed_at = excluded.last_reviewed_at,
          reviews = excluded.reviews,
          lapses = excluded.lapses
      `,
      args: { reflectionId, ...next }
    },
    {
      sql: `INSERT INTO review_log (reflection_id, grade, reviewed_at) VALUES (?, ?, ?)`,
      args: [reflectionId, grade, next.lastReviewedAt]
    }
  ], "write");

  return findReviewState(reflectionId);
}

// Statements (for a batch) deleting review data of the reflections selected by
// `reflectionIdsSql` (a SELECT id ... subquery) with its `args`
export function reviewDeleteStatements(reflectionIdsSql, args) {
  return [
    { sql: `DELETE FROM review_state WHERE reflection_id IN (${reflectionIdsSql})`, args },
    { sql: `DELETE FROM review_log WHERE reflection_id IN (${reflectionIdsSql})`, args }
  ];
}

export function allReviewDeleteStatements() {
  return [`DELETE FROM review_state`, `DELETE FROM review_log`];
}
