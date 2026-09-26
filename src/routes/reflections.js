import { Router } from "express";
import {
  findAll,
  findById,
  findByProblem,
  upsertReflection
} from "../repositories/reflectionRepository.js";
import { findQueueProblem, removeQueueProblem } from "../repositories/queueRepository.js";
import { STUCK_REASON_KEYS } from "../stuckReasons.js";
import { isHttpUrl, parseTags } from "../validation.js";

export const reflectionRoutes = Router();

const answerFields = [
  "keyObservation",
  "whatMadeMeStuck",
  "pattern",
  "futureTrigger",
  "simplestImplementation"
];

function validateBody(body) {
  const required = [
    "contestId",
    "problemIndex",
    "problemName",
    "problemUrl",
    "timeSpentSeconds",
    ...answerFields
  ];

  for (const field of required) {
    if (
      body[field] === undefined ||
      body[field] === null ||
      String(body[field]).trim() === ""
    ) {
      return `${field} is required.`;
    }
  }

  if (!Number.isInteger(Number(body.contestId))) {
    return "contestId must be an integer.";
  }

  if (!Number.isInteger(Number(body.timeSpentSeconds)) || Number(body.timeSpentSeconds) < 0) {
    return "timeSpentSeconds must be a non-negative integer.";
  }

  if (!isHttpUrl(body.problemUrl)) {
    return "problemUrl must be an http(s) link.";
  }

  if (body.rating != null && body.rating !== "" &&
      !(Number.isInteger(Number(body.rating)) && Number(body.rating) >= 0 && Number(body.rating) <= 5000)) {
    return "rating must be an integer or empty.";
  }

  if (!parseTags(body.tags)) {
    return "tags must be a list of short strings.";
  }

  if (answerFields.some(field => String(body[field]).length > 20000) || String(body.problemName).length > 200) {
    return "An answer is too long.";
  }

  if (body.stuckReason != null && body.stuckReason !== "" && !STUCK_REASON_KEYS.has(body.stuckReason)) {
    return "stuckReason is not a known reason.";
  }

  return null;
}

reflectionRoutes.get("/", async (_req, res) => {
  try {
    return res.json(await findAll());
  } catch (_) {
    return res.status(500).json({
      error: "Could not load reflections from the database."
    });
  }
});

reflectionRoutes.get("/by-id/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid reflection ID." });
  }

  try {
    const reflection = await findById(id);
    if (!reflection) {
      return res.status(404).json({ error: "Reflection not found." });
    }
    return res.json(reflection);
  } catch (_) {
    return res.status(500).json({
      error: "Could not load reflection from the database."
    });
  }
});

reflectionRoutes.get("/:contestId/:index", async (req, res) => {
  const contestId = Number(req.params.contestId);
  const problemIndex = String(req.params.index).toUpperCase();

  if (!Number.isInteger(contestId)) {
    return res.status(400).json({ error: "Invalid contest ID." });
  }

  try {
    const reflection = await findByProblem(contestId, problemIndex);

    if (!reflection) {
      return res.status(404).json({ error: "Reflection not found." });
    }

    return res.json(reflection);
  } catch (_) {
    return res.status(500).json({
      error: "Could not load this reflection from the database."
    });
  }
});

reflectionRoutes.post("/", async (req, res) => {
  const error = validateBody(req.body);

  if (error) {
    return res.status(400).json({ error });
  }

  const input = {
    contestId: Number(req.body.contestId),
    problemIndex: String(req.body.problemIndex).toUpperCase(),
    problemName: String(req.body.problemName).trim(),
    rating: req.body.rating == null || req.body.rating === "" ? null : Number(req.body.rating),
    tags: parseTags(req.body.tags),
    problemUrl: String(req.body.problemUrl).trim(),
    timeSpentSeconds: Number(req.body.timeSpentSeconds),
    keyObservation: String(req.body.keyObservation).trim(),
    whatMadeMeStuck: String(req.body.whatMadeMeStuck).trim(),
    stuckReason: req.body.stuckReason ? String(req.body.stuckReason) : null,
    pattern: String(req.body.pattern).trim(),
    futureTrigger: String(req.body.futureTrigger).trim(),
    simplestImplementation: String(req.body.simplestImplementation).trim()
  };

  if (!/^[A-Z][0-9A-Z]*$/.test(input.problemIndex)) {
    return res.status(400).json({ error: "problemIndex is invalid." });
  }

  try {
    const isEdit = Boolean(await findByProblem(input.contestId, input.problemIndex));
    if (!isEdit && !(await findQueueProblem(input.contestId, input.problemIndex))) {
      return res.status(409).json({
        error: "This problem is no longer in your practice queue."
      });
    }

    const reflection = await upsertReflection(input);
    try {
      await removeQueueProblem(input.contestId, input.problemIndex);
    } catch (_) {}
    return res.status(201).json(reflection);
  } catch (_) {
    return res.status(500).json({
      error: "Could not save reflection to the database."
    });
  }
});
