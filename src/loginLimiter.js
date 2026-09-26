import { collections, dbReady } from "./db/database.js";

// Brute-force guard for the password login: after MAX_FAILURES wrong
// passwords from one IP within WINDOW_MS, that IP is refused until the window
// ends. Counters live in MongoDB so every serverless instance shares them.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

// On Vercel the platform sets x-forwarded-for (a client can't forge the
// first entry); locally only the socket address can be trusted.
export function clientIp(req) {
  if (process.env.VERCEL) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || "unknown";
}

// Minutes until this IP may try again, or 0 when it isn't blocked. If the
// database is unreachable the check is skipped (login still has its delay).
export async function blockedMinutes(ip) {
  try {
    await dbReady();
    const entry = await collections.loginAttempts.findOne({ _id: ip });
    if (!entry || entry.count < MAX_FAILURES || entry.expiresAt <= new Date()) return 0;
    return Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 60000));
  } catch (_) {
    return 0;
  }
}

export async function recordFailure(ip) {
  try {
    await dbReady();
    const now = new Date();
    const live = { $gt: ["$expiresAt", now] };
    // Counts within the current window; starts a new window after it ends
    await collections.loginAttempts.updateOne(
      { _id: ip },
      [{
        $set: {
          count: { $cond: [live, { $add: ["$count", 1] }, 1] },
          expiresAt: { $cond: [live, "$expiresAt", new Date(now.getTime() + WINDOW_MS)] }
        }
      }],
      { upsert: true }
    );
  } catch (_) {}
}

export async function clearFailures(ip) {
  try {
    await collections.loginAttempts.deleteOne({ _id: ip });
  } catch (_) {}
}
