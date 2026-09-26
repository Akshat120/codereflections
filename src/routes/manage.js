import { Router } from "express";
import { db } from "../db/database.js";
import {
  findAll as findAllReflections,
  deleteByProblem as deleteReflectionByProblem,
  deleteAllReflections
} from "../repositories/reflectionRepository.js";
import {
  getAllQueue,
  removeQueueProblem,
  clearQueueAll
} from "../repositories/queueRepository.js";

export const manageRoutes = Router();

manageRoutes.get("/problems", (_req, res) => {
  try {
    const reflections = findAllReflections();
    const queue = getAllQueue();

    const problemMap = new Map();

    // Add reflections
    for (const r of reflections) {
      const key = `${r.contestId}_${r.problemIndex}`;
      problemMap.set(key, {
        contestId: r.contestId,
        index: r.problemIndex,
        name: r.problemName,
        rating: r.rating,
        tags: r.tags || [],
        url: r.problemUrl,
        timeSpentSeconds: r.timeSpentSeconds,
        inJournal: true,
        inQueue: false,
        journalId: r.id,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        solvedAt: r.createdAt || r.updatedAt,
        date: r.updatedAt || r.createdAt
      });
    }

    // Merge queue problems
    for (const q of queue) {
      const key = `${q.contestId}_${q.index}`;
      if (problemMap.has(key)) {
        const existing = problemMap.get(key);
        existing.inQueue = true;
        if (!existing.date) existing.date = q.addedAt;
      } else {
        problemMap.set(key, {
          contestId: q.contestId,
          index: q.index,
          name: q.name,
          rating: q.rating,
          tags: q.tags || [],
          url: q.url,
          timeSpentSeconds: q.timeSpentSeconds,
          inJournal: false,
          inQueue: true,
          journalId: null,
          createdAt: null,
          updatedAt: q.addedAt,
          solvedAt: null,
          date: q.addedAt
        });
      }
    }

    const merged = Array.from(problemMap.values()).sort((a, b) => {
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });

    return res.json({
      problems: merged,
      totalCount: merged.length,
      reflectionsCount: reflections.length,
      queueCount: queue.length
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not load problems from database." });
  }
});

manageRoutes.delete("/problems/:contestId/:index", (req, res) => {
  const contestId = Number(req.params.contestId);
  const index = String(req.params.index).toUpperCase();

  if (!Number.isInteger(contestId) || !index) {
    return res.status(400).json({ error: "Invalid contestId or index." });
  }

  try {
    const runDelete = db.transaction(() => {
      deleteReflectionByProblem(contestId, index);
      removeQueueProblem(contestId, index);
    });

    runDelete();

    return res.json({
      success: true,
      message: `Problem ${contestId}${index} removed from everywhere in the database.`,
      contestId,
      index
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete problem from database." });
  }
});

  manageRoutes.delete("/problems", (_req, res) => {
  try {
    const runDeleteAll = db.transaction(() => {
      deleteAllReflections();
      clearQueueAll();
    });

    runDeleteAll();

    return res.json({
      success: true,
      message: "All problems and reflections permanently removed from everywhere in the database."
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to clear database." });
  }
});

const updateProblemHandler = (req, res) => {
  const contestId = Number(req.params.contestId);
  const index = String(req.params.index).toUpperCase();

  if (!Number.isInteger(contestId) || !index) {
    return res.status(400).json({ error: "Invalid contestId or index." });
  }

  const { timeSpentSeconds, date } = req.body;
  if (timeSpentSeconds == null && !date) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  let newTime = null;
  if (timeSpentSeconds != null) {
    newTime = Math.max(0, Number(timeSpentSeconds) || 0);
  }

  let isoDate = null;
  if (date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: "Invalid date format." });
    }
    isoDate = d.toISOString();
  }

  try {
    const runUpdate = db.transaction(() => {
      // 1. Update reflections table if problem exists there
      if (newTime != null && isoDate != null) {
        db.prepare(`
          UPDATE reflections
          SET time_spent_seconds = ?, created_at = ?, updated_at = ?
          WHERE contest_id = ? AND problem_index = ?
        `).run(newTime, isoDate, isoDate, contestId, index);
      } else if (newTime != null) {
        db.prepare(`
          UPDATE reflections
          SET time_spent_seconds = ?
          WHERE contest_id = ? AND problem_index = ?
        `).run(newTime, contestId, index);
      } else if (isoDate != null) {
        db.prepare(`
          UPDATE reflections
          SET created_at = ?, updated_at = ?
          WHERE contest_id = ? AND problem_index = ?
        `).run(isoDate, isoDate, contestId, index);
      }

      // 2. Update practice_queue table if problem exists there
      if (newTime != null && isoDate != null) {
        db.prepare(`
          UPDATE practice_queue
          SET time_spent_seconds = ?, added_at = ?
          WHERE contest_id = ? AND problem_index = ?
        `).run(newTime, isoDate, contestId, index);
      } else if (newTime != null) {
        db.prepare(`
          UPDATE practice_queue
          SET time_spent_seconds = ?
          WHERE contest_id = ? AND problem_index = ?
        `).run(newTime, contestId, index);
      } else if (isoDate != null) {
        db.prepare(`
          UPDATE practice_queue
          SET added_at = ?
          WHERE contest_id = ? AND problem_index = ?
        `).run(isoDate, contestId, index);
      }
    });

    runUpdate();

    return res.json({
      success: true,
      message: `Updated problem ${contestId}${index}.`,
      contestId,
      index,
      timeSpentSeconds: newTime,
      date: isoDate,
      solvedAt: isoDate
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update problem in database: " + err.message });
  }
};

manageRoutes.patch("/problems/:contestId/:index", updateProblemHandler);
manageRoutes.put("/problems/:contestId/:index", updateProblemHandler);
