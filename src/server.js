import app from "./app.js";
import { dbReady } from "./db/database.js";

// Local development server. On Vercel, api/index.js serves the same app.
const PORT = process.env.PORT || 3000;

await dbReady();

app.listen(PORT, () => {
  console.log(`Problem Reflection running at http://localhost:${PORT}`);
});
