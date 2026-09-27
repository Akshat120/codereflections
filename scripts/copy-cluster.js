// Copies the journal database from one MongoDB cluster to another, e.g. to
// move a free Atlas cluster to a new region (free clusters can't change
// region in place). Uses the app's own MongoDB driver: nothing else to install.
//
//   Copy (also saves a backup file first):
//     SOURCE_MONGODB_URI="mongodb+srv://...old..." \
//     TARGET_MONGODB_URI="mongodb+srv://...new..." npm run copy:cluster
//
//   Only download a backup file:
//     SOURCE_MONGODB_URI="..." npm run copy:cluster -- --backup-only
//
//   Push a backup file to a cluster:
//     TARGET_MONGODB_URI="..." npm run copy:cluster -- --restore backups/<file>.json
//
// Options: --force replaces data already in the target (otherwise it refuses).
// MONGODB_DB picks the database (default "codereflections"); TARGET_MONGODB_DB
// the target's, if different.
//
// Every collection is copied with all its documents (ids and types kept) and
// its indexes (unique keys, the login lock-out TTL). Counts are checked at the
// end. Backups go to backups/ (git-ignored): they hold your whole journal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BSON, MongoClient } from "mongodb";

const { EJSON } = BSON;
const args = process.argv.slice(2);
const force = args.includes("--force");
const backupOnly = args.includes("--backup-only");
const restoreIndex = args.indexOf("--restore");
const restoreFile = restoreIndex >= 0 ? args[restoreIndex + 1] : null;

const sourceUri = (process.env.SOURCE_MONGODB_URI || "").trim();
const targetUri = (process.env.TARGET_MONGODB_URI || "").trim();
const sourceDbName = process.env.MONGODB_DB || "codereflections";
const targetDbName = process.env.TARGET_MONGODB_DB || sourceDbName;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = path.join(root, "backups");
const BATCH = 1000;

// Shown instead of a URI, so passwords never reach the terminal
function describe(uri) {
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:"));
    return url.host;
  } catch (_) {
    return "(unparseable URI)";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function connect(uri, label) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: "codereflections-copy" });
  try {
    await client.connect();
  } catch (error) {
    fail(`Could not connect to the ${label} cluster (${describe(uri)}): ${error.message}\n` +
      "Check the URI, the database user's password, and Atlas → Network Access for this computer's IP.");
  }
  return client;
}

// { collections: { name: { indexes, documents } } } from the source database
async function exportDatabase(db) {
  const exported = {};
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name, type } of infos) {
    if (name.startsWith("system.") || type === "view") continue;
    const collection = db.collection(name);
    const [documents, indexes] = await Promise.all([
      collection.find({}).toArray(),
      collection.listIndexes().toArray()
    ]);
    exported[name] = { indexes: indexes.filter(index => index.name !== "_id_"), documents };
  }
  return exported;
}

function saveBackup(exported) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir, `${sourceDbName}-${stamp}.json`);
  // Canonical Extended JSON keeps ObjectIds, dates and number types exactly
  const data = { database: sourceDbName, exportedAt: new Date().toISOString(), collections: exported };
  fs.writeFileSync(file, EJSON.stringify(data, null, 2, { relaxed: false }));
  return file;
}

function loadBackup(file) {
  if (!fs.existsSync(file)) fail(`Backup file not found: ${file}`);
  const data = EJSON.parse(fs.readFileSync(file, "utf8"), { relaxed: false });
  if (!data?.collections || typeof data.collections !== "object") fail(`${file} is not a backup made by this script.`);
  return data.collections;
}

function summary(exported) {
  return Object.entries(exported).map(([name, { documents }]) => `${name}: ${documents.length}`).join(", ") || "(empty)";
}

async function importDatabase(db, exported) {
  const existing = {};
  for (const name of Object.keys(exported)) {
    const count = await db.collection(name).countDocuments();
    if (count) existing[name] = count;
  }
  if (Object.keys(existing).length && !force) {
    fail(`The target already has data: ${JSON.stringify(existing)}\nNothing written. Re-run with --force to replace it.`);
  }

  for (const [name, { indexes, documents }] of Object.entries(exported)) {
    const collection = db.collection(name);
    if (force) await collection.deleteMany({});
    for (const index of indexes) {
      const { key, name: indexName, v, ns, ...options } = index;
      await collection.createIndex(key, { name: indexName, ...options });
    }
    for (let i = 0; i < documents.length; i += BATCH) {
      await collection.insertMany(documents.slice(i, i + BATCH), { ordered: true });
    }
  }

  let ok = true;
  for (const [name, { documents }] of Object.entries(exported)) {
    const count = await db.collection(name).countDocuments();
    const match = count === documents.length;
    ok = ok && match;
    console.log(`${match ? "ok " : "MISMATCH"} ${name}: ${count} of ${documents.length} documents`);
  }
  return ok;
}

async function main() {
  if (restoreIndex >= 0 && !restoreFile) fail("--restore needs a backup file: --restore backups/<file>.json");
  const needsSource = !restoreFile;
  const needsTarget = !backupOnly;
  if (needsSource && !sourceUri) fail("Set SOURCE_MONGODB_URI to the cluster to copy from.");
  if (needsTarget && !targetUri) fail("Set TARGET_MONGODB_URI to the cluster to copy to.");
  if (needsSource && needsTarget && sourceUri === targetUri && sourceDbName === targetDbName) {
    fail("Source and target are the same database.");
  }

  let exported;
  if (restoreFile) {
    exported = loadBackup(restoreFile);
    console.log(`Backup ${restoreFile}: ${summary(exported)}`);
  } else {
    const source = await connect(sourceUri, "source");
    try {
      console.log(`Source: ${describe(sourceUri)} / ${sourceDbName}`);
      exported = await exportDatabase(source.db(sourceDbName));
    } finally {
      await source.close();
    }
    if (!Object.values(exported).some(({ documents }) => documents.length)) {
      fail(`The source database "${sourceDbName}" is empty; nothing to copy. (Is MONGODB_DB right?)`);
    }
    console.log(`Read ${summary(exported)}`);
    const file = saveBackup(exported);
    console.log(`Backup saved: ${path.relative(root, file)}`);
    if (backupOnly) return;
  }

  const target = await connect(targetUri, "target");
  try {
    console.log(`Target: ${describe(targetUri)} / ${targetDbName}`);
    const ok = await importDatabase(target.db(targetDbName), exported);
    if (!ok) fail("Some collections don't match; the backup file above still has everything.");
    console.log("Done. Point MONGODB_URI (in Vercel) at the new cluster and redeploy.");
  } finally {
    await target.close();
  }
}

main().catch(error => fail(`Copy failed: ${error.message}`));
