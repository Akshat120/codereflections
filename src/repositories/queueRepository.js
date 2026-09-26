import { collections, nextIds, withTransaction } from "../db/database.js";

const { queue } = collections;

function mapDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    contestId: doc.contestId,
    index: doc.index,
    name: doc.name,
    rating: doc.rating ?? null,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    url: doc.url,
    timeSpentSeconds: doc.timeSpentSeconds ?? 0,
    timerRunning: Boolean(doc.timerRunning),
    status: doc.status,
    addedAt: doc.addedAt
  };
}

function problemKey(contestId, index) {
  return { contestId: Number(contestId), index: String(index).toUpperCase() };
}

export async function getAllQueue(options = {}) {
  const docs = await queue.find({}, { sort: { id: 1 }, ...options }).toArray();
  return docs.map(mapDoc);
}

export async function findQueueProblem(contestId, index) {
  return mapDoc(await queue.findOne(problemKey(contestId, index)));
}

// Adds or updates several problems together (all or none). A problem already
// in the queue keeps its id (its place in the queue) and addedAt.
export async function upsertQueueProblems(problems) {
  await withTransaction(async session => {
    const firstId = await nextIds("practice_queue", problems.length, { session });
    await queue.bulkWrite(
      problems.map((problem, i) => ({
        updateOne: {
          filter: problemKey(problem.contestId, problem.index),
          update: {
            $set: {
              name: String(problem.name).trim(),
              rating: problem.rating == null ? null : Number(problem.rating),
              tags: Array.isArray(problem.tags) ? problem.tags.map(String) : [],
              url: String(problem.url).trim(),
              timeSpentSeconds: Number(problem.timeSpentSeconds) || 0,
              timerRunning: Boolean(problem.timerRunning),
              status: problem.status || "queued"
            },
            $setOnInsert: {
              id: firstId + i,
              addedAt: problem.addedAt || new Date().toISOString()
            }
          },
          upsert: true
        }
      })),
      { session }
    );
  });
  return getAllQueue();
}

// Marks one problem active and every other one queued, in a single update
export async function setActiveQueueProblem(contestId, index) {
  const key = problemKey(contestId, index);
  await queue.updateMany({}, [
    {
      $set: {
        status: {
          $cond: [
            {
              $and: [
                { $eq: ["$contestId", { $literal: key.contestId }] },
                { $eq: ["$index", { $literal: key.index }] }
              ]
            },
            "active",
            "queued"
          ]
        }
      }
    }
  ]);
  return getAllQueue();
}

export async function updateQueueProblemTime(contestId, index, timeSpentSeconds, timerRunning) {
  await queue.updateOne(problemKey(contestId, index), {
    $set: {
      timeSpentSeconds: Number(timeSpentSeconds) || 0,
      timerRunning: Boolean(timerRunning)
    }
  });
  return getAllQueue();
}

// Sets the time spent and/or the date added; a null value leaves it unchanged
export async function updateQueueProblemTimeAndDate(contestId, index, { timeSpentSeconds, date }, options = {}) {
  const set = {};
  if (timeSpentSeconds != null) set.timeSpentSeconds = timeSpentSeconds;
  if (date != null) set.addedAt = date;
  if (Object.keys(set).length) {
    await queue.updateOne(problemKey(contestId, index), { $set: set }, options);
  }
}

export async function deleteQueueProblem(contestId, index, options = {}) {
  await queue.deleteOne(problemKey(contestId, index), options);
}

export async function removeQueueProblem(contestId, index) {
  await deleteQueueProblem(contestId, index);
  return getAllQueue();
}

export async function deleteAllQueue(options = {}) {
  await queue.deleteMany({}, options);
}

export async function clearQueueAll() {
  await deleteAllQueue();
  return [];
}
