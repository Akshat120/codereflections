// Vercel serverless entry: every /api/* request (and /health) is rewritten here
// by vercel.json and handled by the same Express app used locally.
//
// The rewrite passes the original path as ?__path=..., because Vercel may hand
// the function the rewritten path (/api/index) instead of the one the browser
// asked for. Restoring it here makes routing work either way.
import app from "../src/app.js";

export default function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const originalPath = url.searchParams.get("__path");
  if (originalPath && (originalPath === "/health" || originalPath.startsWith("/api/"))) {
    url.searchParams.delete("__path");
    const query = url.searchParams.toString();
    req.url = originalPath + (query ? `?${query}` : "");
  }
  return app(req, res);
}
