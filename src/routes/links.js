import { Router } from "express";
import { requireAllowed } from "../featureFlags.js";
import {
  createLink,
  deleteLink,
  findAllLinks
} from "../repositories/linkRepository.js";
import { findByProblem } from "../repositories/reflectionRepository.js";
import { getProblem } from "../services/codeforces.js";
import { parseContestId, parseProblemIndex } from "../validation.js";

// Links between similar problems ("Related problems" on a reflection)
export const linkRoutes = Router();

const NOTE_MAX = 300;

// { contestId, index } or null
function parseProblem(value) {
  const contestId = parseContestId(value?.contestId);
  const index = parseProblemIndex(value?.index);
  return contestId && index ? { contestId, index } : null;
}

// The name and rating shown next to the link: from the reflection when there
// is one, otherwise from the Codeforces problemset (left empty when Codeforces
// can't be reached; the link still works).
async function describe(problem) {
  const reflection = await findByProblem(problem.contestId, problem.index);
  if (reflection) return { ...problem, name: reflection.problemName, rating: reflection.rating };
  try {
    const found = await getProblem(problem.contestId, problem.index);
    return { ...problem, name: found?.name ?? null, rating: found?.rating ?? null };
  } catch (_) {
    return { ...problem, name: null, rating: null };
  }
}

linkRoutes.get("/", async (_req, res) => {
  try {
    return res.json(await findAllLinks());
  } catch (_) {
    return res.status(500).json({ error: "Could not load problem links from the database." });
  }
});

linkRoutes.post("/", async (req, res) => {
  const from = parseProblem(req.body?.from);
  const to = parseProblem(req.body?.to);
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!from || !to) return res.status(400).json({ error: "Give both problems as a contest ID and an index (e.g. 1915D)." });
  if (from.contestId === to.contestId && from.index === to.index) {
    return res.status(400).json({ error: "A problem can't be linked to itself." });
  }
  if (note.length > NOTE_MAX) return res.status(400).json({ error: `The note is too long (at most ${NOTE_MAX} characters).` });

  try {
    const [a, b] = await Promise.all([describe(from), describe(to)]);
    const link = await createLink(a, b, note);
    if (!link) return res.status(409).json({ error: "These problems are already linked." });
    return res.status(201).json(link);
  } catch (_) {
    return res.status(500).json({ error: "Could not save the link to the database." });
  }
});

// Unlinking changes what a reflection shows, so it follows the edit flags
linkRoutes.delete("/:contestA/:indexA/:contestB/:indexB", requireAllowed("editReflection"), async (req, res) => {
  const a = parseProblem({ contestId: req.params.contestA, index: req.params.indexA });
  const b = parseProblem({ contestId: req.params.contestB, index: req.params.indexB });
  if (!a || !b) return res.status(400).json({ error: "Invalid problem in the link." });

  try {
    if (!(await deleteLink(a, b))) return res.status(404).json({ error: "These problems are not linked." });
    return res.json({ success: true });
  } catch (_) {
    return res.status(500).json({ error: "Could not remove the link from the database." });
  }
});
