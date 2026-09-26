import { Router } from "express";
import { db } from "../db/database.js";
import { findByProblem as findReflection } from "../repositories/reflectionRepository.js";
import {
  getAllQueue,
  upsertQueueProblem,
  setActiveQueueProblem,
  updateQueueProblemTime,
  removeQueueProblem,
  clearQueueAll
} from "../repositories/queueRepository.js";

export const queueRoutes = Router();

queueRoutes.get("/", (_req, res) => {
  try {
    return res.json(getAllQueue());
  } catch (err) {
    return res.status(500).json({ error: "Could not load practice queue from database." });
  }
});

queueRoutes.post("/", (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    for (const item of items) {
      if (!item.contestId || !item.index || !item.name || !item.url) {
        return res.status(400).json({ error: "Missing required problem fields." });
      }
    }

    // A problem that has been reflected on has left the queue for good.
    const reflected = items.filter(item =>
      findReflection(Number(item.contestId), String(item.index).toUpperCase())
    );
    if (reflected.length) {
      const ids = reflected.map(item => `${item.contestId}${String(item.index).toUpperCase()}`);
      return res.status(409).json({
        error: `${ids.join(", ")} already reflected. Edit it from Progress instead.`,
        reflected: ids
      });
    }

    db.transaction(() => {
      for (const item of items) upsertQueueProblem(item);
    })();
    return res.status(201).json(getAllQueue());
  } catch (err) {
    return res.status(500).json({ error: "Could not save to queue in database." });
  }
});

queueRoutes.put("/active", (req, res) => {
  try {
    const { contestId, index } = req.body;
    if (!contestId || !index) {
      return res.status(400).json({ error: "contestId and index are required." });
    }
    const updated = setActiveQueueProblem(contestId, index);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not set active problem in database." });
  }
});

queueRoutes.put("/:contestId/:index", (req, res) => {
  try {
    const { contestId, index } = req.params;
    const { timeSpentSeconds, timerRunning } = req.body;
    const updated = updateQueueProblemTime(contestId, index, timeSpentSeconds, timerRunning);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not update queue problem in database." });
  }
});

queueRoutes.delete("/:contestId/:index", (req, res) => {
  try {
    const { contestId, index } = req.params;
    const updated = removeQueueProblem(contestId, index);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not remove problem from queue." });
  }
});

queueRoutes.delete("/", (_req, res) => {
  try {
    const updated = clearQueueAll();
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Could not clear queue in database." });
  }
});
