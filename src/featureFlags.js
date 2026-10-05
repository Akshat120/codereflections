// Feature flags, read from environment variables (set them where the other
// settings live: .env locally, Vercel → Environment Variables, Cloudflare →
// Variables and Secrets). Every flag is on unless set to false / 0 / off / no.
//
// Each kind of edit or delete has two independent flags:
//   ALLOW_<KIND>  the server accepts the request (off: refused; the link stays)
//   SHOW_<KIND>   its link / button is shown (off: hidden; the request still works)
// To lock an action and hide its link, turn both off.
// and group flags switch a whole family off at once:
//   ALLOW_EDITS, SHOW_EDIT_LINKS      every edit kind
//   ALLOW_DELETES, SHOW_DELETE_LINKS  every delete kind
const ACTIONS = {
  editReflection: {
    allow: ["ALLOW_EDITS", "ALLOW_EDIT_REFLECTION"],
    show: ["SHOW_EDIT_LINKS", "SHOW_EDIT_REFLECTION"],
    label: "Editing saved reflections"
  },
  editTime: {
    allow: ["ALLOW_EDITS", "ALLOW_EDIT_TIME"],
    show: ["SHOW_EDIT_LINKS", "SHOW_EDIT_TIME"],
    label: "Editing a problem's time and date"
  },
  deleteProblem: {
    allow: ["ALLOW_DELETES", "ALLOW_DELETE_PROBLEM"],
    show: ["SHOW_DELETE_LINKS", "SHOW_DELETE_PROBLEM"],
    label: "Deleting a problem"
  },
  deleteAll: {
    allow: ["ALLOW_DELETES", "ALLOW_DELETE_ALL"],
    show: ["SHOW_DELETE_LINKS", "SHOW_DELETE_ALL"],
    label: "Deleting all problems"
  }
};

const isOff = name => /^(false|0|off|no)$/i.test(String(process.env[name] ?? "").trim());
const allOn = names => names.every(name => !isOff(name));

// { allow: { editReflection: true, ... }, show: { ... } }
export function featureFlags() {
  const allow = {};
  const show = {};
  for (const [action, flags] of Object.entries(ACTIONS)) {
    allow[action] = allOn(flags.allow);
    show[action] = allOn(flags.show);
  }
  return { allow, show };
}

export function actionAllowed(action) {
  return allOn(ACTIONS[action].allow);
}

export function actionOffMessage(action) {
  const { label, allow } = ACTIONS[action];
  return `${label} is turned off on this server (${allow.join(" / ")}).`;
}

// Route guard: requireAllowed("deleteProblem")
export function requireAllowed(action) {
  return (_req, res, next) => {
    if (actionAllowed(action)) return next();
    return res.status(403).json({ error: actionOffMessage(action) });
  };
}
