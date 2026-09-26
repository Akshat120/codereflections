import { db } from "../db/database.js";
import { deleteReviewData, deleteAllReviewData } from "./reviewRepository.js";

const selectBase = `
  SELECT
    id,
    contest_id AS contestId,
    problem_index AS problemIndex,
    problem_name AS problemName,
    rating,
    tags_json AS tagsJson,
    problem_url AS problemUrl,
    time_spent_seconds AS timeSpentSeconds,
    key_observation AS keyObservation,
    what_made_me_stuck AS whatMadeMeStuck,
    stuck_reason AS stuckReason,
    pattern,
    future_trigger AS futureTrigger,
    simplest_implementation AS simplestImplementation,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM reflections
`;

function mapRow(row) {
  if (!row) return null;

  return {
    ...row,
    tags: JSON.parse(row.tagsJson)
  };
}

export function findAll() {
  return db
    .prepare(`${selectBase} ORDER BY updated_at DESC`)
    .all()
    .map(mapRow);
}

export function findByProblem(contestId, problemIndex) {
  return mapRow(
    db
      .prepare(
        `${selectBase}
         WHERE contest_id = ? AND problem_index = ?`
      )
      .get(contestId, problemIndex)
  );
}

export function findById(id) {
  return mapRow(
    db
      .prepare(
        `${selectBase}
         WHERE id = ?`
      )
      .get(id)
  );
}

export function upsertReflection(input) {
  const now = new Date().toISOString();

  const sql = `
    INSERT INTO reflections (
      contest_id,
      problem_index,
      problem_name,
      rating,
      tags_json,
      problem_url,
      time_spent_seconds,
      key_observation,
      what_made_me_stuck,
      stuck_reason,
      pattern,
      future_trigger,
      simplest_implementation,
      created_at,
      updated_at
    )
    VALUES (
      @contestId,
      @problemIndex,
      @problemName,
      @rating,
      @tagsJson,
      @problemUrl,
      @timeSpentSeconds,
      @keyObservation,
      @whatMadeMeStuck,
      @stuckReason,
      @pattern,
      @futureTrigger,
      @simplestImplementation,
      @now,
      @now
    )
    ON CONFLICT(contest_id, problem_index)
    DO UPDATE SET
      problem_name = excluded.problem_name,
      rating = excluded.rating,
      tags_json = excluded.tags_json,
      problem_url = excluded.problem_url,
      time_spent_seconds = excluded.time_spent_seconds,
      key_observation = excluded.key_observation,
      what_made_me_stuck = excluded.what_made_me_stuck,
      stuck_reason = excluded.stuck_reason,
      pattern = excluded.pattern,
      future_trigger = excluded.future_trigger,
      simplest_implementation = excluded.simplest_implementation,
      updated_at = excluded.updated_at
  `;

  db.prepare(sql).run({
    ...input,
    tagsJson: JSON.stringify(input.tags),
    now
  });

  return findByProblem(input.contestId, input.problemIndex);
}

export function deleteByProblem(contestId, problemIndex) {
  const existing = findByProblem(Number(contestId), String(problemIndex).toUpperCase());
  if (existing) deleteReviewData(existing.id);

  const stmt = db.prepare(`
    DELETE FROM reflections
    WHERE contest_id = ? AND problem_index = ?
  `);
  const result = stmt.run(Number(contestId), String(problemIndex).toUpperCase());
  return result.changes > 0;
}

export function deleteAllReflections() {
  deleteAllReviewData();
  const result = db.prepare(`DELETE FROM reflections`).run();
  return result.changes;
}
