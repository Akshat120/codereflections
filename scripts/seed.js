// Fills the local development database with the sample journal in
// scripts/seed-data.js, so the app has something to show on first run.
//
//   npm run seed              # refuses when the journal already has data
//   npm run seed -- --force   # replaces the journal with the sample
//
// Only writes to a MongoDB on this machine (the default, or a MONGODB_URI
// pointing at localhost): a sample journal must never land in a real one. To
// seed a remote development cluster on purpose, add --allow-remote.
import { client, collections, initDb } from "../src/db/database.js";
import { INTERVAL_DAYS, nextState } from "../src/repositories/reviewRepository.js";
import { STUCK_REASON_KEYS } from "../src/stuckReasons.js";
import { writeJournal } from "./lib/journal.js";
import { QUEUE, REFLECTIONS } from "./seed-data.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const allowRemote = args.includes("--allow-remote");

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function isLocalUri(uri) {
  if (!uri) return true; // the app's default: mongodb://127.0.0.1:27017
  return /^mongodb:\/\/([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?]|$)/i.test(uri);
}

// "1420C1" → { contestId: 1420, index: "C1" }
function parseProblem(code) {
  const match = /^(\d+)([A-Z][0-9A-Z]*)$/.exec(code);
  if (!match) throw new Error(`Bad problem code in the sample data: ${code}`);
  return { contestId: Number(match[1]), index: match[2] };
}

const problemUrl = ({ contestId, index }) =>
  `https://codeforces.com/problemset/problem/${contestId}/${index}`;

// A moment `daysAgo` days back, a little different for each entry. Today's
// entries stay within today, so "Reflections today" counts them.
function timeAgo(now, daysAgo, n) {
  const offset = ((n * 37) % 180) * MINUTE_MS;
  if (daysAgo > 0) return new Date(now.getTime() - daysAgo * DAY_MS - offset);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return new Date(now.getTime() - Math.min(offset, (now - midnight) / 2));
}

// The review history of one reflection: each grade is given on the day the
// review fell due, as far as those days are in the past.
function simulateReviews(reflection, grades, now) {
  const log = [];
  let state = {
    stage: 0,
    dueAt: new Date(new Date(reflection.createdAt).getTime() + INTERVAL_DAYS[0] * DAY_MS).toISOString(),
    lastReviewedAt: null,
    reviews: 0,
    lapses: 0
  };
  for (const grade of grades) {
    const reviewedAt = new Date(state.dueAt);
    if (reviewedAt > now) break;
    state = nextState(state, grade, reviewedAt);
    log.push({ reflectionId: reflection.id, grade, reviewedAt: state.lastReviewedAt });
  }
  return { state: log.length ? { reflectionId: reflection.id, ...state } : null, log };
}

function buildJournal(now) {
  const docs = { reflections: [], practice_queue: [], review_state: [], review_log: [] };

  // Oldest first, so ids follow the order the reflections were written in
  const ordered = [...REFLECTIONS].sort((a, b) => b.daysAgo - a.daysAgo);
  ordered.forEach((entry, n) => {
    if (!STUCK_REASON_KEYS.has(entry.stuckReason)) {
      throw new Error(`${entry.problem}: unknown stuck reason "${entry.stuckReason}"`);
    }
    const problem = parseProblem(entry.problem);
    const at = timeAgo(now, entry.daysAgo, n).toISOString();
    const reflection = {
      id: n + 1,
      contestId: problem.contestId,
      problemIndex: problem.index,
      problemName: entry.name,
      rating: entry.rating ?? null,
      tags: entry.tags,
      problemUrl: problemUrl(problem),
      timeSpentSeconds: entry.minutes * 60 + (n * 17) % 60,
      keyObservation: entry.keyObservation,
      whatMadeMeStuck: entry.whatMadeMeStuck,
      stuckReason: entry.stuckReason,
      pattern: entry.pattern,
      futureTrigger: entry.futureTrigger,
      simplestImplementation: `\`\`\`cpp\n${entry.code}\n\`\`\``,
      createdAt: at,
      updatedAt: at
    };
    docs.reflections.push(reflection);

    const { state, log } = simulateReviews(reflection, entry.reviews ?? [], now);
    if (state) docs.review_state.push(state);
    docs.review_log.push(...log);
  });

  QUEUE.forEach((entry, n) => {
    const problem = parseProblem(entry.problem);
    docs.practice_queue.push({
      id: n + 1,
      contestId: problem.contestId,
      index: problem.index,
      name: entry.name,
      rating: entry.rating ?? null,
      tags: entry.tags,
      url: problemUrl(problem),
      timeSpentSeconds: (entry.minutes ?? 0) * 60,
      timerRunning: false,
      status: entry.status ?? "queued",
      addedAt: timeAgo(now, entry.daysAgo, n).toISOString()
    });
  });

  return docs;
}

async function main() {
  const uri = (process.env.MONGODB_URI || "").trim();
  if (!isLocalUri(uri) && !allowRemote) {
    console.error("MONGODB_URI does not point at this machine, so nothing was written.");
    console.error("The sample journal is for local development. Unset MONGODB_URI to use the local");
    console.error("database, or add --allow-remote if this really is a development cluster.");
    process.exitCode = 1;
    return;
  }

  const docs = buildJournal(new Date());
  console.log(`Target: MongoDB database "${collections.reflections.dbName}" (${uri ? "MONGODB_URI" : "local default"})`);
  await initDb({ waitForIndexes: true });
  if (await writeJournal(docs, { force })) {
    console.log("Done. The sample journal is in the database; open http://localhost:3000.");
  } else {
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    const refused = /ECONNREFUSED|Server selection timed out/i.test(error.message);
    console.error("Seeding failed:", refused ? "no MongoDB is running. Start one with `npm run db:up`." : error.message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
