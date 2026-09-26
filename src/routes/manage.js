import { Router } from "express";
import { db } from "../db/database.js";
import {
  findAll as findAllReflections,
  reflectionDeleteStatements,
  allReflectionDeleteStatements
} from "../repositories/reflectionRepository.js";
import {
  getAllQueue,
  queueDeleteStatement
} from "../repositories/queueRepository.js";

export const manageRoutes = Router();

manageRoutes.get("/problems", async (_req, res) => {
  try {
    const [reflections, queue] = await Promise.all([findAllReflections(), getAllQueue()]);

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

manageRoutes.delete("/problems/:contestId/:index", async (req, res) => {
  const contestId = Number(req.params.contestId);
  const index = String(req.params.index).toUpperCase();

  if (!Number.isInteger(contestId) || !index) {
    return res.status(400).json({ error: "Invalid contestId or index." });
  }

  try {
    // Reflection, review data and queue entry go together or not at all
    await db.batch([
      ...reflectionDeleteStatements(contestId, index),
      queueDeleteStatement(contestId, index)
    ], "write");

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

manageRoutes.delete("/problems", async (_req, res) => {
  try {
    await db.batch([...allReflectionDeleteStatements(), `DELETE FROM practice_queue`], "write");

    return res.json({
      success: true,
      message: "All problems and reflections permanently removed from everywhere in the database."
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to clear database." });
  }
});

const updateProblemHandler = async (req, res) => {
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
    // null leaves a field unchanged (COALESCE keeps the current value)
    await db.batch([
      {
        sql: `
          UPDATE reflections
          SET time_spent_seconds = COALESCE(?, time_spent_seconds),
              created_at = COALESCE(?, created_at),
              updated_at = COALESCE(?, updated_at)
          WHERE contest_id = ? AND problem_index = ?
        `,
        args: [newTime, isoDate, isoDate, contestId, index]
      },
      {
        sql: `
          UPDATE practice_queue
          SET time_spent_seconds = COALESCE(?, time_spent_seconds),
              added_at = COALESCE(?, added_at)
          WHERE contest_id = ? AND problem_index = ?
        `,
        args: [newTime, isoDate, contestId, index]
      }
    ], "write");

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
