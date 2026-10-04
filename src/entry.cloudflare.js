// Cloudflare Workers entry point.
// Vercel and local dev keep using src/server.js; this file is only used by
// Cloudflare (see "main" in wrangler.toml). Both share the same app.js.

import express from "express";
import { httpServerHandler } from "cloudflare:node";
import app from "./app.js";
import { dbReady } from "./db/database.js"; // change to the same path server.js uses

// Workers can't open network connections while the file loads, so the
// database connects on the first request and the connection is reused.
let dbPromise = null;

const root = express();

root.use(async (req, res, next) => {
  try {
    dbPromise ??= dbReady();
    await dbPromise;
    next();
  } catch (err) {
    dbPromise = null; // allow a retry on the next request
    next(err);
  }
});

root.use(app);

root.listen(3000);
export default httpServerHandler({ port: 3000 });
