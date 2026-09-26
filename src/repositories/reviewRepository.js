import { collections, withTransaction } from "../db/database.js";

const { reflections, reviewState, reviewLog } = collections;

// Days until the next review, indexed by stage. "Remembered" moves a
// reflection one stage further out; "forgot" sends it back to stage 0.
export const INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120];
export const GRADES = ["forgot", "hard", "remembered"];

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

// A reflection without a review_state document has never been reviewed and
// is first due one day after it was solved.
function mapState(reflection, state) {
  const stage = state?.stage ?? 0;
  return {
    reflectionId: reflection.id,
    contestId: reflection.contestId,
    index: reflection.problemIndex,
    stage,
    intervalDays: INTERVAL_DAYS[stage],
    dueAt: state?.dueAt ?? addDays(new Date(reflection.createdAt), INTERVAL_DAYS[0]),
    lastReviewedAt: state?.lastReviewedAt ?? null,
    reviews: state?.reviews ?? 0,
    lapses: state?.lapses ?? 0
  };
}

const reflectionFields = { projection: { _id: 0, id: 1, contestId: 1, problemIndex: 1, createdAt: 1 } };

export async function findAllReviewStates() {
  const [allReflections, states] = await Promise.all([
    reflections.find({}, reflectionFields).toArray(),
    reviewState.find({}).toArray()
  ]);
  const stateById = new Map(states.map(state => [state.reflectionId, state]));
  return allReflections.map(reflection => mapState(reflection, stateById.get(reflection.id)));
}

export async function findReviewState(reflectionId) {
  const reflection = await reflections.findOne({ id: reflectionId }, reflectionFields);
  if (!reflection) return null;
  return mapState(reflection, await reviewState.findOne({ reflectionId }));
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
  await withTransaction(async session => {
    await reviewState.updateOne(
      { reflectionId },
      { $set: next },
      { upsert: true, session }
    );
    await reviewLog.insertOne(
      { reflectionId, grade, reviewedAt: next.lastReviewedAt },
      { session }
    );
  });

  return findReviewState(reflectionId);
}

// Deletes the review data of the given reflection ids
export async function deleteReviewData(reflectionIds, options = {}) {
  if (!reflectionIds.length) return;
  const filter = { reflectionId: { $in: reflectionIds } };
  await reviewState.deleteMany(filter, options);
  await reviewLog.deleteMany(filter, options);
}

export async function deleteAllReviewData(options = {}) {
  await reviewState.deleteMany({}, options);
  await reviewLog.deleteMany({}, options);
}
