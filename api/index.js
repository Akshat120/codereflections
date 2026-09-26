// Vercel serverless entry: every /api/* request is rewritten here (vercel.json)
// and handled by the same Express app used locally.
import app from "../src/app.js";

export default app;
