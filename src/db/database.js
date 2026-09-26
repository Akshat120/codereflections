import { MongoClient } from "mongodb";

// MongoDB connection. MONGODB_URI points at the server (a MongoDB Atlas cluster
// in production); locally it defaults to a mongod on this machine. MONGODB_DB
// picks the database (default "codereflections").
//
// A missing URI on Vercel is reported by dbReady() on every API call (instead
// of crashing the function), and no query ever runs.
const DEFAULT_LOCAL_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_DB_NAME = "codereflections";

let configError = null;

function databaseUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (process.env.VERCEL) {
    configError = "MONGODB_URI is not set. Add it in the Vercel project settings.";
  }
  return DEFAULT_LOCAL_URI;
}

// One client per process. On Vercel, warm invocations of the same instance
// reuse it (and its connection pool) through globalThis.
const globalCache = globalThis.__codeReflectionsMongo ??= {};

export const client = globalCache.client ??= new MongoClient(databaseUri(), {
  serverSelectionTimeoutMS: 10000,
  appName: "codereflections"
});

export const db = client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);

export const collections = {
  reflections: db.collection("reflections"),
  queue: db.collection("practice_queue"),
  reviewState: db.collection("review_state"),
  reviewLog: db.collection("review_log"),
  counters: db.collection("counters")
};

export async function initDb() {
  await client.connect();
  await Promise.all([
    collections.reflections.createIndexes([
      { key: { contestId: 1, problemIndex: 1 }, unique: true },
      { key: { id: 1 }, unique: true },
      { key: { updatedAt: -1 } }
    ]),
    collections.queue.createIndexes([
      { key: { contestId: 1, index: 1 }, unique: true },
      { key: { id: 1 }, unique: true }
    ]),
    collections.reviewState.createIndex({ reflectionId: 1 }, { unique: true }),
    collections.reviewLog.createIndex({ reflectionId: 1 })
  ]);
  transactionsSupported = await detectTransactionSupport();
}

// Integer ids (reflections are linked and ordered by id in the UI, the queue
// is ordered by id). Reserves `count` consecutive ids and returns the first.
export async function nextIds(name, count = 1, options = {}) {
  const counter = await collections.counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: "after", ...options }
  );
  return counter.seq - count + 1;
}

// Transactions need a replica set or sharded cluster (Atlas always is). A
// standalone local mongod has none, so writes then run one after another.
let transactionsSupported = false;

async function detectTransactionSupport() {
  const hello = await db.admin().command({ hello: 1 });
  return Boolean(hello.setName || hello.msg === "isdbgrid");
}

// Runs `work(session)` as one all-or-nothing transaction when the server
// supports it. `work` must pass { session } to every operation it runs.
export async function withTransaction(work) {
  if (!transactionsSupported) return work(undefined);
  const session = client.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

// Resolves once connected and indexed; every request waits on it (cold starts
// on Vercel run initDb once per instance).
let ready;
export function dbReady() {
  if (configError) return Promise.reject(new Error(configError));
  if (!ready) {
    ready = initDb().catch(error => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}
