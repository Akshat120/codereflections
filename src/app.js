import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dbReady } from "./db/database.js";
import { authRoutes, requireAuth } from "./auth.js";
import { problemRoutes } from "./routes/problems.js";
import { reflectionRoutes } from "./routes/reflections.js";
import { queueRoutes } from "./routes/queue.js";
import { manageRoutes } from "./routes/manage.js";
import { reviewRoutes } from "./routes/reviews.js";
import { STUCK_REASON_GROUPS } from "./stuckReasons.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The Express app, shared by the local server (src/server.js) and the Vercel
// function (api/index.js). On Vercel, static files and page routes are served
// by the CDN (see vercel.json); these static handlers matter only locally.
const app = express();

const publicDir = path.join(__dirname, "../public");
// Files are resolved relative to public/ so a dot-folder anywhere in the
// project's own path (e.g. ~/.projects/...) doesn't make them look hidden.
const sendPublicFile = (res, file) => res.sendFile(file, { root: publicDir });

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

app.get("/login", (_req, res) => {
  sendPublicFile(res, "login.html");
});

for (const route of clientRoutes) {
  app.get(route, (_req, res) => {
    sendPublicFile(res, "index.html");
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Login / session endpoints are open; everything else under /api needs a
// session (when APP_PASSWORD is set), and all but the static stuck-reasons list
// need a ready database.
app.use("/api", authRoutes);
app.use("/api", requireAuth);

// Static data: answered without waiting for the database
app.get("/api/stuck-reasons", (_req, res) => {
  res.json(STUCK_REASON_GROUPS);
});

app.use("/api", async (_req, res, next) => {
  try {
    await dbReady();
    next();
  } catch (error) {
    res.status(500).json({ error: `Database unavailable: ${error.message}` });
  }
});

app.use("/api/problems", problemRoutes);
app.use("/api/reflections", reflectionRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/manage", manageRoutes);
app.use("/api/reviews", reviewRoutes);

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "Not found"
  });
});

export default app;
