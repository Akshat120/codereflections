import { db } from "../db/database.js";

function mapRow(row) {
  if (!row) return null;
  let tags = [];
  try {
    tags = JSON.parse(row.tags_json || "[]");
  } catch (_) {}

  return {
    id: row.id,
    contestId: row.contest_id,
    index: row.problem_index,
    name: row.problem_name,
    rating: row.rating,
    tags,
    url: row.problem_url,
    timeSpentSeconds: row.time_spent_seconds,
    timerRunning: Boolean(row.timer_running),
    status: row.status,
    addedAt: row.added_at
  };
}

export async function getAllQueue() {
  const result = await db.execute(`SELECT * FROM practice_queue ORDER BY id ASC`);
  return result.rows.map(mapRow);
}

export async function findQueueProblem(contestId, index) {
  const result = await db.execute({
    sql: `SELECT * FROM practice_queue WHERE contest_id = ? AND problem_index = ?`,
    args: [Number(contestId), String(index).toUpperCase()]
  });
  return mapRow(result.rows[0]);
}

// Statement (for a batch) that inserts or updates one queued problem
export function queueUpsertStatement(problem) {
  return {
    sql: `
      INSERT INTO practice_queue (
        contest_id, problem_index, problem_name, rating,
        tags_json, problem_url, time_spent_seconds, timer_running, status, added_at
      ) VALUES (
        :contestId, :index, :name, :rating,
        :tagsJson, :url, :timeSpentSeconds, :timerRunning, :status, :addedAt
      )
      ON CONFLICT(contest_id, problem_index) DO UPDATE SET
        problem_name = excluded.problem_name,
        rating = excluded.rating,
        tags_json = excluded.tags_json,
        problem_url = excluded.problem_url,
        time_spent_seconds = excluded.time_spent_seconds,
        timer_running = excluded.timer_running,
        status = excluded.status
    `,
    args: {
      contestId: Number(problem.contestId),
      index: String(problem.index).toUpperCase(),
      name: String(problem.name).trim(),
      rating: problem.rating == null ? null : Number(problem.rating),
      tagsJson: JSON.stringify(problem.tags || []),
      url: String(problem.url).trim(),
      timeSpentSeconds: Number(problem.timeSpentSeconds) || 0,
      timerRunning: problem.timerRunning ? 1 : 0,
      status: problem.status || "queued",
      addedAt: problem.addedAt || new Date().toISOString()
    }
  };
}

// Adds or updates several problems together (all or none)
export async function upsertQueueProblems(problems) {
  await db.batch(problems.map(queueUpsertStatement), "write");
  return getAllQueue();
}

export async function setActiveQueueProblem(contestId, index) {
  await db.execute({
    sql: `
      UPDATE practice_queue
      SET status = CASE
        WHEN contest_id = ? AND problem_index = ? THEN 'active'
        ELSE 'queued'
      END
    `,
    args: [Number(contestId), String(index).toUpperCase()]
  });
  return getAllQueue();
}

export async function updateQueueProblemTime(contestId, index, timeSpentSeconds, timerRunning) {
  await db.execute({
    sql: `
      UPDATE practice_queue
      SET time_spent_seconds = ?, timer_running = ?
      WHERE contest_id = ? AND problem_index = ?
    `,
    args: [
      Number(timeSpentSeconds) || 0,
      timerRunning ? 1 : 0,
      Number(contestId),
      String(index).toUpperCase()
    ]
  });
  return getAllQueue();
}

// Statement (for a batch) that removes one problem from the queue
export function queueDeleteStatement(contestId, index) {
  return {
    sql: `DELETE FROM practice_queue WHERE contest_id = ? AND problem_index = ?`,
    args: [Number(contestId), String(index).toUpperCase()]
  };
}

export async function removeQueueProblem(contestId, index) {
  await db.execute(queueDeleteStatement(contestId, index));
  return getAllQueue();
}

export async function clearQueueAll() {
  await db.execute(`DELETE FROM practice_queue`);
  return [];
}
