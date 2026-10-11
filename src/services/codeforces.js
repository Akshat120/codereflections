const API_URLS = [
  "https://codeforces.com/api/problemset.problems",
  "https://mirror.codeforces.com/api/problemset.problems"
];

let cache = {
  expiresAt: 0,
  problems: null
};

const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getProblem(contestId, index) {
  const problems = await getProblemset();

  const normalized = String(index).toUpperCase();

  return problems.find(
    (problem) =>
      Number(problem.contestId) === Number(contestId) &&
      String(problem.index).toUpperCase() === normalized
  ) ?? null;
}

async function getProblemset() {
  if (cache.problems && Date.now() < cache.expiresAt) {
    return cache.problems;
  }

  let lastError;

  for (const url of API_URLS) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "CodeforcesProblemReflection/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Codeforces API HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status !== "OK") {
        throw new Error("Codeforces API returned an error");
      }

      cache = {
        problems: data.result.problems,
        expiresAt: Date.now() + CACHE_TTL_MS
      };

      return cache.problems;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Codeforces metadata unavailable: ${lastError?.message ?? "unknown error"}`
  );
}

const USER_INFO_URLS = [
  "https://codeforces.com/api/user.info",
  "https://mirror.codeforces.com/api/user.info"
];

// Public profile of a Codeforces user (rating, rank, avatar, ...), or null
// when there is no user with this handle. Never cached: it is asked for only
// when the owner presses "Sync".
export async function getUserInfo(handle) {
  let lastError;

  for (const url of USER_INFO_URLS) {
    try {
      const response = await fetch(`${url}?handles=${encodeURIComponent(handle)}`, {
        headers: {
          "User-Agent": "CodeforcesProblemReflection/1.0"
        }
      });
      // An unknown handle comes back as HTTP 400 with status FAILED
      const data = await response.json().catch(() => null);

      if (data?.status === "FAILED" && /not found/i.test(data.comment || "")) {
        return null;
      }
      if (!response.ok || data?.status !== "OK") {
        throw new Error(data?.comment || `Codeforces API HTTP ${response.status}`);
      }

      return data.result[0] ?? null;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Codeforces profile unavailable: ${lastError?.message ?? "unknown error"}`
  );
}
