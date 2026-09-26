import { Router } from "express";
import { withTransaction } from "../db/database.js";
import {
  findAll as findAllReflections,
  deleteReflection,
  deleteAllReflections,
  updateReflectionTimeAndDate
} from "../repositories/reflectionRepository.js";
import {
  getAllQueue,
  deleteQueueProblem,
  deleteAllQueue,
  updateQueueProblemTimeAndDate
} from "../repositories/queueRepository.js";
import { parseContestId, parseProblemIndex } from "../validation.js";

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
  const contestId = parseContestId(req.params.contestId);
  const index = parseProblemIndex(req.params.index);

  if (!contestId || !index) {
    return res.status(400).json({ error: "Invalid contestId or index." });
  }

  try {
    // Reflection, review data and queue entry go together or not at all
    await withTransaction(async session => {
      await deleteReflection(contestId, index, { session });
      await deleteQueueProblem(contestId, index, { session });
    });

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
    await withTransaction(async session => {
      await deleteAllReflections({ session });
      await deleteAllQueue({ session });
    });

    return res.json({
      success: true,
      message: "All problems and reflections permanently removed from everywhere in the database."
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to clear database." });
  }
});

const updateProblemHandler = async (req, res) => {
  const contestId = parseContestId(req.params.contestId);
  const index = parseProblemIndex(req.params.index);

  if (!contestId || !index) {
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
    // null leaves a field unchanged
    const changes = { timeSpentSeconds: newTime, date: isoDate };
    await withTransaction(async session => {
      await updateReflectionTimeAndDate(contestId, index, changes, { session });
      await updateQueueProblemTimeAndDate(contestId, index, changes, { session });
    });

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
    return res.status(500).json({ error: "Failed to update problem in database." });
  }
};

manageRoutes.patch("/problems/:contestId/:index", updateProblemHandler);
manageRoutes.put("/problems/:contestId/:index", updateProblemHandler);
