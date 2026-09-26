import { Router } from "express";
import {
  findAllReviewStates,
  recordReview,
  GRADES,
  INTERVAL_DAYS
} from "../repositories/reviewRepository.js";

export const reviewRoutes = Router();

reviewRoutes.get("/", async (_req, res) => {
  try {
    return res.json({ intervals: INTERVAL_DAYS, reviews: await findAllReviewStates() });
  } catch (_) {
    return res.status(500).json({ error: "Could not load review schedule." });
  }
});

reviewRoutes.post("/:reflectionId", async (req, res) => {
  const reflectionId = Number(req.params.reflectionId);
  const grade = req.body?.grade;

  if (!Number.isInteger(reflectionId)) {
    return res.status(400).json({ error: "Invalid reflection ID." });
  }
  if (!GRADES.includes(grade)) {
    return res.status(400).json({ error: `grade must be one of: ${GRADES.join(", ")}.` });
  }

  try {
    const state = await recordReview(reflectionId, grade);
    if (!state) {
      return res.status(404).json({ error: "Reflection not found." });
    }
    return res.json(state);
  } catch (_) {
    return res.status(500).json({ error: "Could not save review." });
  }
});
