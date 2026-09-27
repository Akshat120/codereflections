import { MongoClient } from "mongodb";

// MongoDB connection. MONGODB_URI points at the server (a MongoDB Atlas cluster
// in production); locally it defaults to a mongod on this machine. MONGODB_DB
// picks the database (default "codereflections").
//
// A missing or malformed URI is reported by dbReady() on every API call
// (instead of crashing the function, which would take login down with it), and
// no query ever runs.
const DEFAULT_LOCAL_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_DB_NAME = "codereflections";

const clientOptions = {
  // Fail fast when the server is unreachable (e.g. an Atlas cluster whose
  // Network Access list doesn't allow Vercel): the UI waits on the first calls
  serverSelectionTimeoutMS: 5000,
  appName: "codereflections"
};

// Forgives the usual paste slips: surrounding whitespace or quotes
function databaseUri() {
  const uri = (process.env.MONGODB_URI || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (uri) return { uri };
  if (process.env.VERCEL) {
    return { uri: DEFAULT_LOCAL_URI, error: "MONGODB_URI is not set. Add it in the Vercel project settings." };
  }
  return { uri: DEFAULT_LOCAL_URI };
}

function createClient() {
  const { uri, error } = databaseUri();
  if (/<[^>]*password[^>]*>/i.test(uri)) {
    return {
      client: new MongoClient(DEFAULT_LOCAL_URI, clientOptions),
      configError: "MONGODB_URI still contains the <db_password> placeholder. Replace it with the database user's password."
    };
  }
  try {
    return { client: new MongoClient(uri, clientOptions), configError: error ?? null };
  } catch (parseError) {
    return {
      client: new MongoClient(DEFAULT_LOCAL_URI, clientOptions),
      configError: `MONGODB_URI is not a valid connection string (${parseError.message}). ` +
        "Copy it again from Atlas (Connect → Drivers); URL-encode special characters in the password (@ → %40, : → %3A, / → %2F)."
    };
  }
}

// One client per process. On Vercel, warm invocations of the same instance
// reuse it (and its connection pool) through globalThis.
const cached = globalThis.__codeReflectionsMongo ??= createClient();
const { configError } = cached;
export const client = cached.client;

export const db = client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);

export const collections = {
  reflections: db.collection("reflections"),
  queue: db.collection("practice_queue"),
  reviewState: db.collection("review_state"),
  reviewLog: db.collection("review_log"),
  counters: db.collection("counters"),
  loginAttempts: db.collection("login_attempts")
};

function ensureIndexes() {
  return Promise.all([
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
    collections.reviewLog.createIndex({ reflectionId: 1 }),
    // Failed-login counters delete themselves when their window ends
    collections.loginAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

// Connects and makes sure the indexes exist. The app doesn't wait for the
// indexes (they already exist after the first run, and creating them costs a
// round trip each on every cold start); the import scripts do, with
// { waitForIndexes: true }, since they write before any request could.
export async function initDb({ waitForIndexes = false } = {}) {
  await client.connect();
  transactionsSupported = await detectTransactionSupport();
  const indexes = ensureIndexes();
  if (waitForIndexes) {
    await indexes;
  } else {
    indexes.catch(error => console.error("Could not create MongoDB indexes:", error.message));
  }
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
  // Known from connecting already (no extra round trip); ask only if not
  const type = client.topology?.description?.type;
  if (type && type !== "Unknown") return type !== "Single";
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

// Adds what to check to the driver's errors for the usual misconfigurations
function explain(error) {
  const message = (error?.message || String(error)).replace(/\.+$/, "");
  if (/bad auth|authentication failed/i.test(message)) {
    return `${message}. Check the username and password in MONGODB_URI against Atlas → Database Access (URL-encode special characters in the password).`;
  }
  if (/querySrv|ENOTFOUND|EBADNAME/i.test(message)) {
    return `${message}. The cluster address in MONGODB_URI looks wrong (or the password has an unencoded @); copy the string again from Atlas → Connect → Drivers.`;
  }
  if (/Server selection timed out|ECONNREFUSED|ETIMEDOUT|ECONNRESET|SSL|TLS/i.test(message)) {
    return `${message}. The cluster can't be reached: allow 0.0.0.0/0 in Atlas → Network Access, and check the cluster isn't paused.`;
  }
  if (/not authorized|Unauthorized/i.test(message)) {
    return `${message}. Give the database user the "Read and write to any database" role in Atlas → Database Access.`;
  }
  return message;
}

// Resolves once connected and indexed; every request waits on it (cold starts
// on Vercel run initDb once per instance).
let ready;
export function dbReady() {
  if (configError) return Promise.reject(new Error(configError));
  if (!ready) {
    ready = initDb().catch(error => {
      ready = undefined;
      throw new Error(explain(error));
    });
  }
  return ready;
}

// Start connecting as soon as the server (or a cold serverless instance)
// loads, so the handshake with the database overlaps the first request's
// login check instead of following it. Errors surface on the next dbReady().
if (!configError) dbReady().catch(() => {});
