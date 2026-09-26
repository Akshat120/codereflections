import { Router } from "express";
import { findByProblem as findReflection } from "../repositories/reflectionRepository.js";
import {
  getAllQueue,
  upsertQueueProblems,
  setActiveQueueProblem,
  updateQueueProblemTime,
  removeQueueProblem,
  clearQueueAll
} from "../repositories/queueRepository.js";
import { parseContestId, parseProblemIndex, parseQueueItem } from "../validation.js";

export const queueRoutes = Router();

queueRoutes.get("/", async (_req, res) => {
  try {
    return res.json(await getAllQueue());
  } catch (err) {
    return res.status(500).json({ error: "Could not load practice queue from database." });
  }
});

queueRoutes.post("/", async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    if (raw.length === 0 || raw.length > 100) {
      return res.status(400).json({ error: "Send between 1 and 100 problems." });
    }
    const items = [];
    for (const item of raw) {
      const { problem, error } = parseQueueItem(item);
      if (error) return res.status(400).json({ error });
      items.push(problem);
    }

    // A problem that has been reflected on has left the queue for good.
    const reflected = [];
    for (const item of items) {
      if (await findReflection(item.contestId, item.index)) {
        reflected.push(item);
      }
    }
    if (reflected.length) {
      const ids = reflected.map(item => `${item.contestId}${item.index}`);
      return res.status(409).json({
        error: `${ids.join(", ")} already reflected. Edit it from Progress instead.`,
        reflected: ids
      });
    }

    return res.status(201).json(await upsertQueueProblems(items));
  } catch (err) {
    return res.status(500).json({ error: "Could not save to queue in database." });
  }
});

queueRoutes.put("/active", async (req, res) => {
  try {
    const contestId = parseContestId(req.body?.contestId);
    const index = parseProblemIndex(req.body?.index);
    if (!contestId || !index) {
      return res.status(400).json({ error: "A valid contestId and index are required." });
    }
    const updated = await setActiveQueueProblem(contestId, index);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not set active problem in database." });
  }
});

queueRoutes.put("/:contestId/:index", async (req, res) => {
  try {
    const contestId = parseContestId(req.params.contestId);
    const index = parseProblemIndex(req.params.index);
    if (!contestId || !index) return res.status(400).json({ error: "Invalid problem." });
    const { timeSpentSeconds, timerRunning } = req.body ?? {};
    const updated = await updateQueueProblemTime(contestId, index, timeSpentSeconds, timerRunning);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not update queue problem in database." });
  }
});

queueRoutes.delete("/:contestId/:index", async (req, res) => {
  try {
    const contestId = parseContestId(req.params.contestId);
    const index = parseProblemIndex(req.params.index);
    if (!contestId || !index) return res.status(400).json({ error: "Invalid problem." });
    const updated = await removeQueueProblem(contestId, index);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not remove problem from queue." });
  }
});

queueRoutes.delete("/", async (_req, res) => {
  try {
    const updated = await clearQueueAll();
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not clear queue in database." });
  }
});
