// Feature flags, read from environment variables (set them where the other
// settings live: .env locally, Vercel → Environment Variables, Cloudflare →
// Variables and Secrets). Both are on unless set to false / 0 / off / no.
//
//   ALLOW_EDITS=false      The server refuses to edit or delete saved problems
//                          and reflections (adding new ones still works), and
//                          the edit / delete links are hidden.
//   SHOW_EDIT_LINKS=false  Only hides the edit / delete links; the server still
//                          accepts edits.
const isOff = value => /^(false|0|off|no)$/i.test(String(value ?? "").trim());

export function featureFlags() {
  const editsAllowed = !isOff(process.env.ALLOW_EDITS);
  return {
    editsAllowed,
    showEditLinks: editsAllowed && !isOff(process.env.SHOW_EDIT_LINKS)
  };
}

export const EDITS_OFF_MESSAGE = "Editing and deleting are turned off on this server (ALLOW_EDITS).";

// Guards routes that change or delete saved data
export function requireEditsAllowed(_req, res, next) {
  if (featureFlags().editsAllowed) return next();
  return res.status(403).json({ error: EDITS_OFF_MESSAGE });
}
