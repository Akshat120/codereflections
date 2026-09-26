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

export function getAllQueue() {
  const stmt = db.prepare(`
    SELECT * FROM practice_queue ORDER BY id ASC
  `);
  return stmt.all().map(mapRow);
}

export function findQueueProblem(contestId, index) {
  const stmt = db.prepare(`
    SELECT * FROM practice_queue WHERE contest_id = ? AND problem_index = ?
  `);
  return mapRow(stmt.get(Number(contestId), String(index).toUpperCase()));
}

export function upsertQueueProblem(problem) {
  const stmt = db.prepare(`
    INSERT INTO practice_queue (
      contest_id, problem_index, problem_name, rating,
      tags_json, problem_url, time_spent_seconds, timer_running, status, added_at
    ) VALUES (
      @contestId, @index, @name, @rating,
      @tagsJson, @url, @timeSpentSeconds, @timerRunning, @status, @addedAt
    )
    ON CONFLICT(contest_id, problem_index) DO UPDATE SET
      problem_name = excluded.problem_name,
      rating = excluded.rating,
      tags_json = excluded.tags_json,
      problem_url = excluded.problem_url,
      time_spent_seconds = excluded.time_spent_seconds,
      timer_running = excluded.timer_running,
      status = excluded.status
  `);

  stmt.run({
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
  });

  return getAllQueue();
}

export function setActiveQueueProblem(contestId, index) {
  const normContestId = Number(contestId);
  const normIndex = String(index).toUpperCase();

  const stmt = db.prepare(`
    UPDATE practice_queue
    SET status = CASE
      WHEN contest_id = ? AND problem_index = ? THEN 'active'
      ELSE 'queued'
    END
  `);
  stmt.run(normContestId, normIndex);
  return getAllQueue();
}

export function updateQueueProblemTime(contestId, index, timeSpentSeconds, timerRunning) {
  const stmt = db.prepare(`
    UPDATE practice_queue
    SET time_spent_seconds = ?, timer_running = ?
    WHERE contest_id = ? AND problem_index = ?
  `);
  stmt.run(
    Number(timeSpentSeconds) || 0,
    timerRunning ? 1 : 0,
    Number(contestId),
    String(index).toUpperCase()
  );
  return getAllQueue();
}

export function removeQueueProblem(contestId, index) {
  const stmt = db.prepare(`
    DELETE FROM practice_queue
    WHERE contest_id = ? AND problem_index = ?
  `);
  stmt.run(Number(contestId), String(index).toUpperCase());
  return getAllQueue();
}

export function clearQueueAll() {
  db.prepare(`DELETE FROM practice_queue`).run();
  return [];
}
