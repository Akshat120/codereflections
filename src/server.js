import app from "./app.js";
import { dbReady } from "./db/database.js";
import { authEnabled } from "./auth.js";

// Local development server. On Vercel, api/index.js serves the same app.
const PORT = process.env.PORT || 3000;
// Without APP_PASSWORD there is no login, so listen on this machine only
// (not the whole network) unless HOST says otherwise.
const HOST = process.env.HOST || (authEnabled() ? "0.0.0.0" : "127.0.0.1");

await dbReady();

app.listen(PORT, () => {
  console.log(`CodeReflections running at http://localhost:${PORT}`);
});
