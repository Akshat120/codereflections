import { db } from "../db/database.js";
import { reviewDeleteStatements, allReviewDeleteStatements } from "./reviewRepository.js";

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

export async function findAll() {
  const result = await db.execute(`${selectBase} ORDER BY updated_at DESC`);
  return result.rows.map(mapRow);
}

export async function findByProblem(contestId, problemIndex) {
  const result = await db.execute({
    sql: `${selectBase} WHERE contest_id = ? AND problem_index = ?`,
    args: [contestId, problemIndex]
  });
  return mapRow(result.rows[0]);
}

export async function findById(id) {
  const result = await db.execute({
    sql: `${selectBase} WHERE id = ?`,
    args: [id]
  });
  return mapRow(result.rows[0]);
}

export async function upsertReflection(input) {
  const now = new Date().toISOString();

  await db.execute({
    sql: `
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
        :contestId,
        :problemIndex,
        :problemName,
        :rating,
        :tagsJson,
        :problemUrl,
        :timeSpentSeconds,
        :keyObservation,
        :whatMadeMeStuck,
        :stuckReason,
        :pattern,
        :futureTrigger,
        :simplestImplementation,
        :now,
        :now
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
    `,
    args: {
      contestId: input.contestId,
      problemIndex: input.problemIndex,
      problemName: input.problemName,
      rating: input.rating,
      tagsJson: JSON.stringify(input.tags),
      problemUrl: input.problemUrl,
      timeSpentSeconds: input.timeSpentSeconds,
      keyObservation: input.keyObservation,
      whatMadeMeStuck: input.whatMadeMeStuck,
      stuckReason: input.stuckReason ?? null,
      pattern: input.pattern,
      futureTrigger: input.futureTrigger,
      simplestImplementation: input.simplestImplementation,
      now
    }
  });

  return findByProblem(input.contestId, input.problemIndex);
}

// Statements (for a batch) that delete one problem's reflection and its review data
export function reflectionDeleteStatements(contestId, problemIndex) {
  const args = [Number(contestId), String(problemIndex).toUpperCase()];
  const reflectionIds = `SELECT id FROM reflections WHERE contest_id = ? AND problem_index = ?`;
  return [
    ...reviewDeleteStatements(reflectionIds, args),
    { sql: `DELETE FROM reflections WHERE contest_id = ? AND problem_index = ?`, args }
  ];
}

// Statements (for a batch) that delete every reflection and all review data
export function allReflectionDeleteStatements() {
  return [...allReviewDeleteStatements(), `DELETE FROM reflections`];
}
