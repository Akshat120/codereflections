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
