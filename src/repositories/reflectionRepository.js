import { collections, nextIds } from "../db/database.js";
import { deleteReviewData, deleteAllReviewData } from "./reviewRepository.js";

const { reflections } = collections;

// Fields returned by the API, in order
const FIELDS = [
  "id",
  "contestId",
  "problemIndex",
  "problemName",
  "rating",
  "tags",
  "problemUrl",
  "timeSpentSeconds",
  "keyObservation",
  "whatMadeMeStuck",
  "stuckReason",
  "pattern",
  "futureTrigger",
  "simplestImplementation",
  "createdAt",
  "updatedAt"
];

function mapDoc(doc) {
  if (!doc) return null;
  const reflection = {};
  for (const field of FIELDS) reflection[field] = doc[field] ?? null;
  reflection.tags = Array.isArray(doc.tags) ? doc.tags : [];
  return reflection;
}

function problemKey(contestId, problemIndex) {
  return { contestId: Number(contestId), problemIndex: String(problemIndex).toUpperCase() };
}

export async function findAll() {
  const docs = await reflections.find({}, { sort: { updatedAt: -1 } }).toArray();
  return docs.map(mapDoc);
}

export async function findByProblem(contestId, problemIndex) {
  return mapDoc(await reflections.findOne(problemKey(contestId, problemIndex)));
}

export async function findById(id) {
  return mapDoc(await reflections.findOne({ id }));
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

export async function upsertReflection(input) {
  const now = new Date().toISOString();
  const key = problemKey(input.contestId, input.problemIndex);
  const fields = {
    problemName: input.problemName,
    rating: input.rating,
    tags: input.tags,
    problemUrl: input.problemUrl,
    timeSpentSeconds: input.timeSpentSeconds,
    keyObservation: input.keyObservation,
    whatMadeMeStuck: input.whatMadeMeStuck,
    stuckReason: input.stuckReason ?? null,
    pattern: input.pattern,
    futureTrigger: input.futureTrigger,
    simplestImplementation: input.simplestImplementation,
    updatedAt: now
  };

  // Edit in place when it exists; otherwise insert with a fresh id. If another
  // request inserted the same problem in between, fall back to editing it.
  const updated = await reflections.updateOne(key, { $set: fields });
  if (updated.matchedCount === 0) {
    try {
      const id = await nextIds("reflections");
      await reflections.insertOne({ id, ...key, ...fields, createdAt: now });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      await reflections.updateOne(key, { $set: fields });
    }
  }

  return findByProblem(key.contestId, key.problemIndex);
}

// Sets the time spent and/or the solved date; a null value leaves it unchanged
export async function updateReflectionTimeAndDate(contestId, problemIndex, { timeSpentSeconds, date }, options = {}) {
  const set = {};
  if (timeSpentSeconds != null) set.timeSpentSeconds = timeSpentSeconds;
  if (date != null) {
    set.createdAt = date;
    set.updatedAt = date;
  }
  if (Object.keys(set).length) {
    await reflections.updateOne(problemKey(contestId, problemIndex), { $set: set }, options);
  }
}

// Deletes one problem's reflection and its review data. Pass { session } to
// make it part of a transaction.
export async function deleteReflection(contestId, problemIndex, options = {}) {
  const key = problemKey(contestId, problemIndex);
  const docs = await reflections.find(key, { projection: { id: 1 }, ...options }).toArray();
  await deleteReviewData(docs.map(doc => doc.id), options);
  await reflections.deleteMany(key, options);
}

// Deletes every reflection and all review data
export async function deleteAllReflections(options = {}) {
  await deleteAllReviewData(options);
  await reflections.deleteMany({}, options);
}
