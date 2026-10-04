// Cloudflare Workers entry: wraps the same Express app used locally and on
// Vercel. Static files and pages are served by Cloudflare's assets (see
// wrangler.toml); only /api/* and /health reach this Worker. Each request gets
// its own MongoDB client, since Workers can't share a connection between
// requests; it connects on the first database call (dbReady).
import http from "node:http";
import { httpServerHandler } from "cloudflare:node";
import app from "./app.js";
import { runWithRequestClient } from "./db/database.js";

http.createServer((req, res) => runWithRequestClient(res, () => app(req, res))).listen(3000);
export default httpServerHandler({ port: 3000 });
