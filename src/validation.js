// Validation for problem data arriving at the API. Everything stored is shown
// back in the UI, so identifiers and URLs are held to strict shapes here (the
// frontend escapes too; this is the first line of defence).

// Codeforces problem index: "A", "B1", "F2", ...
const INDEX_PATTERN = /^[A-Z][0-9A-Z]{0,4}$/;
const QUEUE_STATUSES = new Set(["queued", "active", "completed"]);

export function parseContestId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id < 1e7 ? id : null;
}

export function parseProblemIndex(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const index = String(value).trim().toUpperCase();
  return INDEX_PATTERN.test(index) ? index : null;
}

// Only absolute http(s) URLs, without characters that could break out of an
// HTML attribute
export function isHttpUrl(value) {
  return typeof value === "string" && value.length <= 500 && /^https?:\/\/[^\s"'<>`]+$/i.test(value.trim());
}

function text(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function rating(value) {
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 5000 ? { ok: true, value: n } : { ok: false };
}

export function parseTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) return null;
  const tags = value.map(tag => text(tag, 60));
  return tags.every(Boolean) ? tags : null;
}

// Returns { problem } (cleaned) or { error }
export function parseQueueItem(item) {
  if (!item || typeof item !== "object") return { error: "Each problem must be an object." };
  const contestId = parseContestId(item.contestId);
  const index = parseProblemIndex(item.index);
  const name = text(item.name, 200);
  const tags = parseTags(item.tags);
  const parsedRating = rating(item.rating);
  if (!contestId) return { error: "contestId must be a positive integer." };
  if (!index) return { error: "index must look like a Codeforces problem index (e.g. A, B1)." };
  if (!name) return { error: "name is required (at most 200 characters)." };
  if (!isHttpUrl(item.url)) return { error: "url must be an http(s) link." };
  if (!parsedRating.ok) return { error: "rating must be an integer or empty." };
  if (!tags) return { error: "tags must be a list of short strings." };
  if (item.status != null && !QUEUE_STATUSES.has(item.status)) return { error: "status is not valid." };
  const timeSpentSeconds = Number(item.timeSpentSeconds ?? 0);
  if (!Number.isInteger(timeSpentSeconds) || timeSpentSeconds < 0) {
    return { error: "timeSpentSeconds must be a non-negative integer." };
  }
  let addedAt;
  if (item.addedAt != null) {
    const date = new Date(item.addedAt);
    if (Number.isNaN(date.getTime())) return { error: "addedAt must be a date." };
    addedAt = date.toISOString();
  }
  return {
    problem: {
      contestId,
      index,
      name,
      rating: parsedRating.value,
      tags,
      url: item.url.trim(),
      timeSpentSeconds,
      timerRunning: item.timerRunning === true,
      status: item.status ?? "queued",
      addedAt
    }
  };
}
