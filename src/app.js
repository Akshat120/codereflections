import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, dbReady } from "./db/database.js";
import { authRoutes, requireAuth } from "./auth.js";
import { problemRoutes } from "./routes/problems.js";
import { reflectionRoutes } from "./routes/reflections.js";
import { queueRoutes } from "./routes/queue.js";
import { manageRoutes } from "./routes/manage.js";
import { reviewRoutes } from "./routes/reviews.js";
import { STUCK_REASON_GROUPS } from "./stuckReasons.js";

// The Express app, shared by the local server (src/server.js), the Vercel
// function (api/index.js) and the Cloudflare Worker (src/entry.cloudflare.js).
// On Vercel and Cloudflare, static files and page routes are served by the CDN
// (see vercel.json, wrangler.toml); the static handlers here matter only locally.
// Workers have no files on disk (import.meta.url isn't a file URL there), so
// they skip them entirely.
const onWorkers = Boolean(process.env.CF_WORKER) || typeof import.meta.url !== "string";
const __dirname = onWorkers ? "/" : path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");

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

// Security headers on every response (vercel.json sets the same ones for the
// static files the CDN serves)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Cross-site request forgery guard for the API: a write must come from this
// site (Origin, when the browser sends one) and, when it has a body, be JSON.
// Plain HTML forms on other sites can do neither.
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === host;
    } catch (_) {}
    if (!sameSite) return res.status(403).json({ error: "Cross-site request refused." });
  }
  const type = req.headers["content-type"];
  if (type && !/^application\/json\s*(;|$)/i.test(type)) {
    return res.status(415).json({ error: "Send JSON (Content-Type: application/json)." });
  }
  return next();
});

app.use(express.json({ limit: "100kb" }));

app.get("/journal", (_req, res) => {
  res.redirect(301, "/progress");
});

if (!onWorkers) {
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
}

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

// Round trip between this server and MongoDB: the median of three pings on
// the (already open) connection, shown in the page footer
app.get("/api/db-ping", async (_req, res) => {
  try {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const start = process.hrtime.bigint();
      await db.command({ ping: 1 });
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    samples.sort((a, b) => a - b);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      dbMs: Math.round(samples[1] * 10) / 10,
      samples: samples.map(ms => Math.round(ms * 10) / 10),
      region: process.env.VERCEL_REGION || null
    });
  } catch (error) {
    res.status(503).json({ error: `Database ping failed: ${error.message}` });
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
