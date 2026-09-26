import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initDb } from "./db/database.js";
import { problemRoutes } from "./routes/problems.js";
import { reflectionRoutes } from "./routes/reflections.js";
import { queueRoutes } from "./routes/queue.js";
import { manageRoutes } from "./routes/manage.js";
import { reviewRoutes } from "./routes/reviews.js";
import { STUCK_REASON_GROUPS } from "./stuckReasons.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

initDb();

const publicDir = path.join(__dirname, "../public");
const indexHtml = path.join(publicDir, "index.html");

const clientRoutes = [
  "/",
  "/load",
  "/problem",
  "/reflect",
  "/review",
  "/practice",
  "/progress",
  "/rule",
  "/edit-reflection",
  "/manage-problems",
  "/stuck-reasons",
  "/tag-times"
];

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/journal", (_req, res) => {
  res.redirect(301, "/progress");
});

for (const route of clientRoutes) {
  app.get(route, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

app.use(express.static(publicDir));
app.use(
  "/vendor/katex",
  express.static(path.join(__dirname, "../node_modules/katex/dist"))
);
app.use(
  "/vendor/prettify",
  express.static(path.join(__dirname, "../node_modules/code-prettify/src"))
);

app.use("/api/problems", problemRoutes);
app.use("/api/reflections", reflectionRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/manage", manageRoutes);
app.use("/api/reviews", reviewRoutes);

app.get("/api/stuck-reasons", (_req, res) => {
  res.json(STUCK_REASON_GROUPS);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "Not found"
  });
});

app.listen(PORT, () => {
  console.log(`Problem Reflection running at http://localhost:${PORT}`);
});
