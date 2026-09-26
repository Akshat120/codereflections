import { Router } from "express";
import { getProblem } from "../services/codeforces.js";

export const problemRoutes = Router();

problemRoutes.get("/:contestId/:index", async (req, res) => {
  const contestId = Number(req.params.contestId);
  const index = String(req.params.index).toUpperCase();

  if (!Number.isInteger(contestId) || !/^[A-Z][0-9A-Z]*$/.test(index)) {
    return res.status(400).json({
      error: "Invalid Codeforces problem identifier."
    });
  }

  try {
    const problem = await getProblem(contestId, index);

    if (!problem) {
      return res.status(404).json({
        error: "Problem not found in the Codeforces problemset."
      });
    }

    return res.json({
      contestId: problem.contestId,
      index: problem.index,
      name: problem.name,
      rating: problem.rating ?? null,
      tags: problem.tags ?? [],
      url: `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`
    });
  } catch (error) {
    return res.status(503).json({
      error:
        "Codeforces metadata is temporarily unavailable. You can try again later.",
      detail: error.message
    });
  }
});
