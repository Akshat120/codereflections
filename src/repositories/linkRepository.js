import { collections } from "../db/database.js";

const { problemLinks } = collections;

// A link joins two problems, in both directions. Problems are named by their
// Codeforces code, so either side may be a problem without a reflection yet.
// The _id is the two codes in a fixed order ("1520D|1915D"), so a pair can
// only be linked once.
export const problemCodeOf = ({ contestId, index }) => `${contestId}${index}`;

function compareProblems(a, b) {
  return a.contestId - b.contestId || a.index.localeCompare(b.index);
}

export function linkId(a, b) {
  return [a, b].sort(compareProblems).map(problemCodeOf).join("|");
}

function mapDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    problems: doc.problems.map(p => ({
      contestId: p.contestId,
      index: p.index,
      name: p.name ?? null,
      rating: p.rating ?? null
    })),
    note: doc.note ?? "",
    createdAt: doc.createdAt
  };
}

// Oldest first, so a reflection lists its links in the order they were made
export async function findAllLinks() {
  const docs = await problemLinks.find({}, { sort: { createdAt: 1 } }).toArray();
  return docs.map(mapDoc);
}

export async function findLink(a, b) {
  return mapDoc(await problemLinks.findOne({ _id: linkId(a, b) }));
}

// Each problem is { contestId, index, name, rating }. Returns the new link, or
// null when the two problems are already linked.
export async function createLink(a, b, note) {
  const problems = [a, b].sort(compareProblems);
  const doc = { _id: linkId(a, b), problems, note, createdAt: new Date().toISOString() };
  try {
    await problemLinks.insertOne(doc);
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
  return mapDoc(doc);
}

// Returns whether a link was removed
export async function deleteLink(a, b) {
  const deleted = await problemLinks.deleteOne({ _id: linkId(a, b) });
  return deleted.deletedCount > 0;
}

// When a problem is removed from everywhere, its links go with it
export async function deleteLinksOf(contestId, index, options = {}) {
  await problemLinks.deleteMany(
    { problems: { $elemMatch: { contestId: Number(contestId), index: String(index).toUpperCase() } } },
    options
  );
}

export async function deleteAllLinks(options = {}) {
  await problemLinks.deleteMany({}, options);
}
