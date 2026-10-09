// When the server has a password set (always on Vercel), an expired or missing
// session makes any /api call return 401: send the user to the login page and
// bring them back here afterwards.
const nativeFetch = window.fetch.bind(window);

// Identical API reads share one request: pages load several views at once
// that each ask for the same data (e.g. /api/reflections). A read is reused
// for a few seconds, and any write (POST/PUT/PATCH/DELETE) to the API clears
// them all, so what you just saved is always read back fresh.
const API_READ_TTL_MS = 3000;
const apiReads = new Map(); // url -> { at, promise of the Response }

function isApiUrl(url) {
  return /^\/api\//.test(new URL(url, location.href).pathname);
}

async function fetchWithLogin(input, init) {
  const response = await nativeFetch(input, init);
  const url = typeof input === "string" ? input : input?.url || "";
  if (response.status === 401 && isApiUrl(url) && !url.includes("/api/login")) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  return response;
}

window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url || "";
  const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  if (!isApiUrl(url)) return fetchWithLogin(input, init);
  if (method !== "GET") {
    // Before (so nothing new reuses old data) and after (so a read that
    // started meanwhile isn't reused either)
    apiReads.clear();
    const write = fetchWithLogin(input, init);
    write.finally(() => apiReads.clear()).catch(() => {});
    return write;
  }

  const key = new URL(url, location.href).pathname + new URL(url, location.href).search;
  const cached = apiReads.get(key);
  if (!cached || Date.now() - cached.at > API_READ_TTL_MS) {
    const promise = fetchWithLogin(input, init);
    apiReads.set(key, { at: Date.now(), promise });
    // Failures aren't worth sharing: the next read tries again
    promise.then(res => { if (!res.ok) apiReads.delete(key); }, () => apiReads.delete(key));
  }
  // Each caller gets its own copy of the body
  return (await apiReads.get(key).promise).clone();
};

// Start the reads every page needs right away, in parallel, instead of one
// round after another as the views ask for them; the views then get these
// responses from the shared reads above.
function prefetchApiReads() {
  const reads = ["/api/stuck-reasons", "/api/queue", "/api/reflections"];
  if (location.pathname === "/" || location.pathname === "/review") reads.push("/api/reviews");
  for (const url of reads) fetch(url).catch(() => {});
}

const state = {
  problems: [],
  activeProblemId: null,
  timerHandle: null
};

// Backward-compatible getters and setters
Object.defineProperty(state, "problem", {
  get() {
    if (!this.activeProblemId) return null;
    return this.problems.find(p => `${p.contestId}_${p.index}` === this.activeProblemId) || null;
  },
  set(val) {
    if (!val) {
      this.activeProblemId = null;
    } else {
      const key = `${val.contestId}_${val.index}`;
      const existing = this.problems.find(p => `${p.contestId}_${p.index}` === key);
      if (!existing) {
        this.problems.push(val);
      } else {
        Object.assign(existing, val);
      }
      this.activeProblemId = key;
    }
  }
});

Object.defineProperty(state, "timerSeconds", {
  get() {
    return this.problem?.timeSpentSeconds || 0;
  },
  set(val) {
    if (this.problem) {
      this.problem.timeSpentSeconds = val;
    }
  }
});

Object.defineProperty(state, "timerRunning", {
  get() {
    return Boolean(this.problem?.timerRunning);
  },
  set(val) {
    if (this.problem) {
      this.problem.timerRunning = Boolean(val);
    }
  }
});

const STORAGE_KEYS = {
  ACTIVE_ID: "cr_active_problem_id",
  TIMER_LAST_TIMESTAMP: "cr_timer_last_timestamp",
  TIMER_SNAPSHOT: "cr_timer_snapshot",
  DRAFT_PREFIX: "cr_draft_",
  HIDDEN_TIME_PROBLEMS: "cf_hidden_time_problems"
};

function getHiddenTimeProblems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HIDDEN_TIME_PROBLEMS);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function isProblemTimeHidden(contestId, index) {
  if (!contestId || !index) return false;
  const key = `${contestId}_${String(index).toUpperCase()}`;
  const hiddenMap = getHiddenTimeProblems();
  return Boolean(hiddenMap[key]);
}

function toggleProblemTimeHidden(contestId, index) {
  if (!contestId || !index) return false;
  const key = `${contestId}_${String(index).toUpperCase()}`;
  const hiddenMap = getHiddenTimeProblems();
  if (hiddenMap[key]) {
    delete hiddenMap[key];
  } else {
    hiddenMap[key] = true;
  }
  try {
    localStorage.setItem(STORAGE_KEYS.HIDDEN_TIME_PROBLEMS, JSON.stringify(hiddenMap));
  } catch (_) {}
  return Boolean(hiddenMap[key]);
}

function clearLocalStorageQueueData() {
  try {
    localStorage.removeItem("cr_problem_queue");
    localStorage.removeItem("cr_active_problem");
    localStorage.removeItem("cr_timer_seconds");
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID);
    localStorage.removeItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP);
    localStorage.removeItem(STORAGE_KEYS.TIMER_SNAPSHOT);
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(STORAGE_KEYS.DRAFT_PREFIX)) {
        localStorage.removeItem(k);
      }
    });
  } catch (_) {}
}

function clearLocalStorageForProblem(key) {
  try {
    localStorage.removeItem(STORAGE_KEYS.DRAFT_PREFIX + key);
    if (state.activeProblemId === key) {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID);
      localStorage.removeItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP);
      localStorage.removeItem(STORAGE_KEYS.TIMER_SNAPSHOT);
    }
    const hiddenMap = getHiddenTimeProblems();
    if (hiddenMap[key]) {
      delete hiddenMap[key];
      localStorage.setItem(STORAGE_KEYS.HIDDEN_TIME_PROBLEMS, JSON.stringify(hiddenMap));
    }
  } catch (_) {}
}

function saveQueueState() {
  try {
    // If queue is empty, completely wipe queue/active data from localStorage
    if (!state.problems.length) {
      clearLocalStorageQueueData();
      return;
    }

    // Only current problem uses localStorage, and only when it is in the queue
    if (state.activeProblemId && state.problems.some(p => `${p.contestId}_${p.index}` === state.activeProblemId)) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, state.activeProblemId);
      // The count is exact as of the last tick, so store that moment with it
      const countedAt = (state.timerRunning && lastTickTimestamp) || Date.now();
      if (state.timerRunning) {
        localStorage.setItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP, String(countedAt));
      } else {
        localStorage.removeItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP);
      }
      localStorage.setItem(STORAGE_KEYS.TIMER_SNAPSHOT, JSON.stringify({
        id: state.activeProblemId,
        seconds: state.timerSeconds,
        running: state.timerRunning,
        at: countedAt
      }));
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID);
      localStorage.removeItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP);
      localStorage.removeItem(STORAGE_KEYS.TIMER_SNAPSHOT);
    }
  } catch (_) {}
}

function saveActiveProblem(problem) {
  state.problem = problem;
  saveQueueState();
}

function saveTimerState() {
  saveQueueState();
}

function syncActiveProblemTimeToDb() {
  if (!state.problem) return;
  try {
    fetch(`/api/queue/${state.problem.contestId}/${state.problem.index}`, {
      method: "PUT",
      keepalive: true, // still delivered when sent from beforeunload
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeSpentSeconds: state.problem.timeSpentSeconds || 0,
        timerRunning: Boolean(state.problem.timerRunning)
      })
    });
  } catch (_) {}
}

let lastTickTimestamp = null;
let lastDbSyncTime = 0;

function reconcileElapsedTime() {
  if (!state.timerRunning || !state.problem) return;
  const lastTime = lastTickTimestamp || Number(localStorage.getItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP) || 0);
  if (lastTime > 0) {
    const now = Date.now();
    const elapsed = Math.floor((now - lastTime) / 1000);
    if (elapsed > 0 && elapsed < 86400 * 7) {
      state.timerSeconds += elapsed;
      lastTickTimestamp = lastTime + elapsed * 1000;
      saveTimerState();
      updateTimer();
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.timerRunning) {
    reconcileElapsedTime();
    updateTimer();
  }
});

window.addEventListener("focus", () => {
  if (state.timerRunning) {
    reconcileElapsedTime();
    updateTimer();
  }
});

async function syncQueueFromDb() {
  try {
    const res = await fetch("/api/queue");
    if (res.ok) {
      const items = await res.json();
      state.problems = items || [];
    } else {
      const { error } = await res.json().catch(() => ({}));
      showMessage(error || `Could not load your practice queue (HTTP ${res.status}).`, true);
    }
  } catch (_) {}

  // If queue is empty in DB, wipe localStorage completely
  if (!state.problems.length) {
    clearLocalStorageQueueData();
    state.activeProblemId = null;
    return;
  }

  // Active problem: only allowed if present in the DB queue
  const activeInQueue = state.problems.find(p => p.status === "active");
  const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_ID);

  if (activeInQueue) {
    state.activeProblemId = `${activeInQueue.contestId}_${activeInQueue.index}`;
  } else if (savedActiveId && state.problems.some(p => `${p.contestId}_${p.index}` === savedActiveId)) {
    state.activeProblemId = savedActiveId;
  } else {
    const first = state.problems[0];
    state.activeProblemId = `${first.contestId}_${first.index}`;
    first.status = "active";
  }

  // Resume from the local snapshot (count + the moment it was exact) when it is
  // at least as far along as the DB copy, which is only written every 10s.
  let restoredFromSnapshot = false;
  try {
    const snap = JSON.parse(localStorage.getItem(STORAGE_KEYS.TIMER_SNAPSHOT) || "null");
    if (snap && snap.id === state.activeProblemId && state.problem &&
        Number(snap.seconds) >= (state.problem.timeSpentSeconds || 0)) {
      state.timerSeconds = Number(snap.seconds);
      state.timerRunning = Boolean(snap.running);
      if (snap.running && snap.at > 0) {
        const elapsed = Math.floor((Date.now() - snap.at) / 1000);
        if (elapsed > 0 && elapsed < 86400 * 7) {
          state.timerSeconds += elapsed;
        }
      }
      restoredFromSnapshot = true;
    }
  } catch (_) {}

  // Otherwise, if the active problem timer was running, add the time since the last tick
  if (!restoredFromSnapshot) try {
    const lastTimestamp = Number(localStorage.getItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP) || 0);
    if (state.timerRunning && lastTimestamp > 0) {
      const now = Date.now();
      const elapsed = Math.floor((now - lastTimestamp) / 1000);
      if (elapsed > 0 && elapsed < 86400 * 7) {
        state.timerSeconds += elapsed;
        lastTickTimestamp = now;
        localStorage.setItem(STORAGE_KEYS.TIMER_LAST_TIMESTAMP, String(now));
      }
    }
  } catch (_) {}

  saveQueueState();

  // Clean up any drafts for problems not in the queue
  try {
    const queueKeys = new Set(state.problems.map(p => `${p.contestId}_${p.index}`));
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(STORAGE_KEYS.DRAFT_PREFIX)) {
        const key = k.slice(STORAGE_KEYS.DRAFT_PREFIX.length);
        if (!queueKeys.has(key)) {
          localStorage.removeItem(k);
        }
      }
    });
  } catch (_) {}
}

// Re-read the queue from the database so a problem removed elsewhere (another
// tab, the manage page, a saved reflection) cannot linger on the Problem or
// Reflect page. In-memory timers of problems still queued are kept as-is.
async function refreshQueueFromDb() {
  let items;
  try {
    const res = await fetch("/api/queue");
    if (!res.ok) return;
    items = await res.json();
  } catch (_) {
    return;
  }

  const keyOf = p => `${p.contestId}_${p.index}`;
  const dbKeys = new Set(items.map(keyOf));
  const localKeys = new Set(state.problems.map(keyOf));
  const removed = state.problems.filter(p => !dbKeys.has(keyOf(p)));
  const added = items.filter(p => !localKeys.has(keyOf(p)));
  if (!removed.length && !added.length) return;

  const activeRemoved = Boolean(state.activeProblemId) && !dbKeys.has(state.activeProblemId);
  if (activeRemoved) {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
  removed.forEach(p => clearLocalStorageForProblem(keyOf(p)));

  state.problems = items.map(item => state.problems.find(p => keyOf(p) === keyOf(item)) || item);

  if (!state.problems.length) {
    state.activeProblemId = null;
    clearLocalStorageQueueData();
    updateTimer();
  } else if (activeRemoved) {
    state.activeProblemId = null;
    const next = state.problems.find(p => p.status === "active") || state.problems[0];
    await setActiveProblem(next, { autoStartTimer: false });
  } else {
    saveQueueState();
  }

  renderProblemViews();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshQueueFromDb();
});

const ROUTES = {
  "/": { page: "home", title: "CodeReflections" },
  "/load": { page: "load", title: "Load Problem · CodeReflections" },
  "/problem": { page: "problem", title: "Current Problem · CodeReflections" },
  "/reflect": { page: "reflect", title: "Reflect · CodeReflections" },
  "/edit-reflection": { page: "edit-reflection", title: "Edit Reflection · CodeReflections" },
  "/journal": { page: "progress", title: "Progress · CodeReflections" },
  "/practice": { page: "practice", title: "Practice · CodeReflections" },
  "/progress": { page: "progress", title: "Progress · CodeReflections" },
  "/rule": { page: "rule", title: "Reflection Rule · CodeReflections" },
  "/review": { page: "review", title: "Review · CodeReflections" },
  "/stuck-reasons": { page: "stuck-reasons", title: "Stuck Reasons · CodeReflections" },
  "/tag-times": { page: "tag-times", title: "Tags by Time · CodeReflections" },
  "/manage-problems": { page: "manage-problems", title: "Manage Problems · CodeReflections" }
};

// Form submission & control listeners
document.getElementById("problem-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadProblem(document.getElementById("problem-url").value.trim());
});

document.getElementById("pause-btn").addEventListener("click", () => {
  if (state.timerRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
});

document.getElementById("reflection-form").addEventListener("submit", saveReflection);

// Navbar search input
const searchInput = document.getElementById("nav-search-input");
if (searchInput) {
  searchInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const val = searchInput.value.trim();
      if (val) {
        await loadProblem(val);
      }
    }
  });
}

// Reflection view / edit mode buttons
const btnEditReflection = document.getElementById("btn-edit-reflection");
const btnCancelEdit = document.getElementById("btn-cancel-edit");

if (btnEditReflection) {
  btnEditReflection.addEventListener("click", () => {
    setReflectionMode("edit");
    setSaveStatus("");
  });
}

if (btnCancelEdit) {
  btnCancelEdit.addEventListener("click", () => {
    const hasExisting = Boolean(document.getElementById("view-q0")?.textContent?.trim());
    if (hasExisting) {
      setReflectionMode("view");
    } else {
      navigate("/problem");
    }
  });
}

// Clear queue button
const btnClearQueue = document.getElementById("btn-clear-queue");
if (btnClearQueue) {
  btnClearQueue.addEventListener("click", () => {
    clearQueue();
  });
}

// Auto-save unsaved draft reflection inputs (five answers + the stuck reason)
function saveReflectionDraft() {
  if (!state.problem) return;
  const draft = [0, 1, 2, 3, 4].map(idx => document.getElementById(`q${idx}`)?.value || "");
  draft.push(document.getElementById("q-stuck-reason")?.value || "");
  try {
    localStorage.setItem(
      STORAGE_KEYS.DRAFT_PREFIX + `${state.problem.contestId}_${state.problem.index}`,
      JSON.stringify(draft)
    );
  } catch (_) {}
}
for (let i = 0; i < 5; i++) {
  document.getElementById(`q${i}`)?.addEventListener("input", saveReflectionDraft);
}
document.getElementById("q-stuck-reason")?.addEventListener("change", saveReflectionDraft);

function setReflectionMode(mode) {
  const isEdit = mode === "edit";
  const viewCard = document.getElementById("reflect-view-card");
  const formEl = document.getElementById("reflection-form");

  if (viewCard) viewCard.classList.toggle("hidden", isEdit);
  if (formEl) formEl.classList.toggle("hidden", !isEdit);

  if (isEdit) {
    document.querySelectorAll('#reflection-form .md-editor-box').forEach(b => {
      const writeTab = b.querySelector('.md-tab[data-tab="write"]');
      if (writeTab && !writeTab.classList.contains("active")) writeTab.click();
    });
  }
}

function toggleSpoiler(spoiler) {
  const content = spoiler.querySelector(".spoiler-content");
  if (!content) {
    spoiler.classList.toggle("open");
    return;
  }

  let startHeight = null;
  if (content._currentAnim) {
    startHeight = content.getBoundingClientRect().height;
    content._currentAnim.cancel();
    content._currentAnim = null;
  }

  const isOpening = !spoiler.classList.contains("open");

  if (isOpening) {
    spoiler.classList.add("open");
    content.style.display = "block";
    const fullHeight = content.offsetHeight;

    if (!fullHeight) {
      content.style.display = "";
      return;
    }

    const cs = window.getComputedStyle(content);
    const padTop = cs.paddingTop;
    const padBottom = cs.paddingBottom;
    const margTop = cs.marginTop;
    const margBottom = cs.marginBottom;
    const borderTop = cs.borderTopWidth;
    const borderBottom = cs.borderBottomWidth;

    const fromHeight = startHeight !== null ? `${startHeight}px` : "0px";
    const fromOpacity = startHeight !== null ? Math.min(1, startHeight / Math.max(1, fullHeight)) : 0;
    const fromTranslate = startHeight !== null ? 0 : -8;

    content._currentAnim = content.animate([
      {
        height: fromHeight,
        paddingTop: startHeight !== null ? padTop : "0px",
        paddingBottom: startHeight !== null ? padBottom : "0px",
        marginTop: startHeight !== null ? margTop : "0px",
        marginBottom: startHeight !== null ? margBottom : "0px",
        borderTopWidth: startHeight !== null ? borderTop : "0px",
        borderBottomWidth: startHeight !== null ? borderBottom : "0px",
        borderColor: startHeight !== null ? "#808286" : "transparent",
        opacity: fromOpacity,
        transform: `translateY(${fromTranslate}px)`,
        overflow: "hidden"
      },
      {
        height: `${fullHeight}px`,
        paddingTop: padTop,
        paddingBottom: padBottom,
        marginTop: margTop,
        marginBottom: margBottom,
        borderTopWidth: borderTop,
        borderBottomWidth: borderBottom,
        borderColor: "#808286",
        opacity: 1,
        transform: "translateY(0)",
        overflow: "hidden"
      }
    ], {
      duration: 500,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)"
    });

    content._currentAnim.onfinish = () => {
      content._currentAnim = null;
      content.style.display = "";
    };
  } else {
    const fullHeight = content.offsetHeight;
    if (!fullHeight) {
      spoiler.classList.remove("open");
      content.style.display = "";
      return;
    }

    const cs = window.getComputedStyle(content);
    const padTop = cs.paddingTop;
    const padBottom = cs.paddingBottom;
    const margTop = cs.marginTop;
    const margBottom = cs.marginBottom;
    const borderTop = cs.borderTopWidth;
    const borderBottom = cs.borderBottomWidth;

    const fromHeight = startHeight !== null ? `${startHeight}px` : `${fullHeight}px`;
    const fromOpacity = startHeight !== null ? Math.min(1, startHeight / Math.max(1, fullHeight)) : 1;

    spoiler.classList.remove("open");
    content.style.display = "block";

    content._currentAnim = content.animate([
      {
        height: fromHeight,
        paddingTop: padTop,
        paddingBottom: padBottom,
        marginTop: margTop,
        marginBottom: margBottom,
        borderTopWidth: borderTop,
        borderBottomWidth: borderBottom,
        borderColor: "#808286",
        opacity: fromOpacity,
        transform: "translateY(0)",
        overflow: "hidden"
      },
      {
        height: "0px",
        paddingTop: "0px",
        paddingBottom: "0px",
        marginTop: "0px",
        marginBottom: "0px",
        borderTopWidth: "0px",
        borderBottomWidth: "0px",
        borderColor: "transparent",
        opacity: 0,
        transform: "translateY(-4px)",
        overflow: "hidden"
      }
    ], {
      duration: 350,
      easing: "cubic-bezier(0.25, 0.8, 0.25, 1)"
    });

    content._currentAnim.onfinish = () => {
      content.style.display = "";
      content._currentAnim = null;
    };
  }
}

function initNavigation() {
  document.body.addEventListener("click", (event) => {
    const spoilerTitle = event.target.closest(".spoiler-title");
    if (spoilerTitle) {
      event.stopPropagation();
      const spoiler = spoilerTitle.closest(".spoiler");
      if (spoiler) {
        toggleSpoiler(spoiler);
      }
      return;
    }

    const link = event.target.closest("a[data-route]");
    if (!link) return;

    event.preventDefault();
    navigate(link.getAttribute("href"));
    // Pages switch without a reload, so start the new one at the top (the
    // browser's back / forward keep their own scroll position)
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });

  window.addEventListener("popstate", () => {
    resolveRoute(window.location.pathname + window.location.search, { replace: true });
  });

  resolveRoute(window.location.pathname + window.location.search, { replace: true });
}

function navigate(path, { replace = false } = {}) {
  const [pathname, search] = path.split("?");
  const route = ROUTES[pathname];

  if (!route) {
    navigate("/", { replace });
    return;
  }

  if (route.requiresProblem && !state.problem) {
    showMessage("Load a Codeforces problem first.", true);
    path = "/load";
  }

  const activeRoute = ROUTES[pathname];

  // When entering reflection or edit page, pause solve timer but remember wasSolving
  if (activeRoute.page === "reflect" || activeRoute.page === "edit-reflection") {
    if (state.timerRunning) {
      if (state.problem) state.problem.wasSolving = true;
      pauseTimer();
    }
  }

  // When returning to the problem page, if user was in an active solve session, auto-resume!
  if (activeRoute.page === "problem" && state.problem && state.problem.wasSolving && !state.timerRunning) {
    startTimer();
  }

  if (replace) {
    history.replaceState({ path }, "", path);
  } else if (window.location.pathname + window.location.search !== path) {
    history.pushState({ path }, "", path);
  }

  showPage(activeRoute.page);
  document.title = activeRoute.title;
  setActiveNav(pathname);

  if (activeRoute.page === "progress") {
    const params = new URLSearchParams(search || "");
    const reason = params.get("reason") || "";
    const tag = params.get("tag") || "";
    const searchFor = (params.get("search") || "").trim();
    if (reason || tag || searchFor) {
      // A link to a specific list (from the full-list pages or dashboard) shows
      // exactly that list, so earlier filters are cleared; sort order is kept.
      resetProgressFilters({ keepUrl: true, keepSort: true });
      if (stuckReasonLabels.has(reason) || STUCK_REASONS.some(r => r.key === reason)) {
        journalFilterState.reason = reason;
      }
      if (searchFor) {
        journalFilterState.search = searchFor;
        const searchInput = document.getElementById("progress-search-input");
        if (searchInput) searchInput.value = searchFor;
      }
      if (tag) {
        journalFilterState.tag = tag;
        const tagSelect = document.getElementById("progress-tag-filter");
        if (tagSelect && [...tagSelect.options].some(o => o.value === tag)) tagSelect.value = tag;
      }
    } else {
      journalFilterState.reason = "";
    }
  }

  if (["journal", "progress", "home", "stuck-reasons", "tag-times"].includes(activeRoute.page)) {
    loadHistory();
  }

  if (activeRoute.page === "home") {
    renderDashboardReviews();
  }

  if (activeRoute.page === "review") {
    loadReviewView();
  }

  if (activeRoute.page === "edit-reflection") {
    const params = new URLSearchParams(search || window.location.search);
    const targetId = params.get("id");
    loadEditReflectionView(targetId);
  }

  if (activeRoute.page === "manage-problems") {
    loadManageProblemsView();
  }

  if (activeRoute.page === "problem" || activeRoute.page === "reflect") {
    refreshQueueFromDb();
  }
}

function resolveRoute(path, { replace = false } = {}) {
  const [pathname] = path.split("?");
  if (!ROUTES[pathname]) {
    path = "/";
  }
  navigate(path, { replace });
}

function showPage(pageName) {
  document.querySelectorAll(".app-page").forEach(page => {
    page.classList.toggle("hidden", page.dataset.page !== pageName);
  });
  const progressFilter = document.getElementById("progress-filter-sidebar-widget");
  if (progressFilter) {
    progressFilter.classList.toggle("hidden", pageName !== "progress");
  }
  const manageFilter = document.getElementById("manage-filter-sidebar-widget");
  if (manageFilter) {
    manageFilter.classList.toggle("hidden", pageName !== "manage-problems");
  }
  for (const id of ["home-weak-reasons-widget", "home-weak-tags-widget"]) {
    document.getElementById(id)?.classList.toggle("hidden", pageName !== "home");
  }
  syncProblemViews();
}

function setActiveNav(path) {
  document.querySelectorAll(".nav-link[data-route]").forEach(link => {
    link.classList.toggle("active", link.getAttribute("href") === path);
  });
  const active = document.querySelector(".nav-link.active");
  const label = document.getElementById("nav-toggle-label");
  if (label) label.textContent = active ? active.textContent.trim() : "Menu";
  setNavOpen(false);
}

// On narrow screens the menu collapses behind a hamburger button that shows
// the current page's name; the links drop down as a list when it is open.
const navBar = document.querySelector(".main-nav");
const navToggle = document.getElementById("nav-toggle");

function setNavOpen(open) {
  if (!navBar || !navToggle) return;
  navBar.classList.toggle("nav-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
}

navToggle?.addEventListener("click", () => {
  setNavOpen(!navBar.classList.contains("nav-open"));
});
document.querySelector(".nav-links")?.addEventListener("click", event => {
  if (event.target.closest("a")) setNavOpen(false);
});
document.addEventListener("click", event => {
  if (navBar && !navBar.contains(event.target)) setNavOpen(false);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && navBar?.classList.contains("nav-open")) {
    setNavOpen(false);
    navToggle.focus();
  }
});

function syncProblemViews() {
  const hasQueue = state.problems.length > 0;
  const hasActive = Boolean(state.problem);

  // On Problems page:
  const problemEmptyEl = document.getElementById("problem-empty");
  if (problemEmptyEl) problemEmptyEl.classList.toggle("hidden", hasQueue);

  const problemContentEl = document.getElementById("problem-content");
  if (problemContentEl) problemContentEl.classList.toggle("hidden", !hasActive);

  renderQueueTable();

  // On Reflect page:
  const reflectEmptyEl = document.getElementById("reflect-empty");
  if (reflectEmptyEl) reflectEmptyEl.classList.toggle("hidden", hasActive);

  const reflectContentEl = document.getElementById("reflect-content");
  if (reflectContentEl) reflectContentEl.classList.toggle("hidden", !hasActive);

  // On Sidebar / Practice:
  const practiceIdleEl = document.getElementById("practice-idle");
  if (practiceIdleEl) practiceIdleEl.classList.toggle("hidden", hasActive);

  const practiceActiveEl = document.getElementById("practice-active");
  if (practiceActiveEl) practiceActiveEl.classList.toggle("hidden", !hasActive);

  const practicePageIdleEl = document.getElementById("practice-page-idle");
  if (practicePageIdleEl) practicePageIdleEl.classList.toggle("hidden", hasActive);

  const practicePageActiveEl = document.getElementById("practice-page-active");
  if (practicePageActiveEl) practicePageActiveEl.classList.toggle("hidden", !hasActive);

  if (hasActive) {
    const p = state.problem;
    const label = `${p.contestId}${p.index} — ${p.name}`;

    const reflectContextEl = document.getElementById("reflect-context");
    if (reflectContextEl) reflectContextEl.textContent = `Reflecting on: ${label}`;

    for (const id of ["practice-problem", "practice-page-problem"]) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = label;
        el.href = safeHref(p.url) === "#" ? "#" : p.url;
      }
    }
    renderReflectionTags(p.tags);
  } else {
    renderReflectionTags([]);
  }
}

function renderProblemViews() {
  if (state.problem) {
    renderProblem();
  }
  syncProblemViews();
}

function formatCfTimestamp(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const hrs = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");

  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffset / 60);
  const remMinutes = absOffset % 60;
  const tzStr = remMinutes === 0 ? `UTC${sign}${offsetHours}` : `UTC${sign}${(offsetHours + remMinutes / 60).toFixed(1)}`;

  return `<div>${mon}/${day}/${year}</div><div>${hrs}:${mins}<sup>${tzStr}</sup></div>`;
}

function renderQueueTable() {
  const queueCard = document.getElementById("problem-queue-card");
  const tbody = document.getElementById("queue-table-body");
  const caption = document.getElementById("queue-caption");

  if (!queueCard || !tbody) return;

  if (!state.problems.length) {
    queueCard.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  queueCard.classList.remove("hidden");
  if (caption) {
    caption.textContent = `Practice Queue (${state.problems.length} problem${state.problems.length === 1 ? "" : "s"})`;
  }

  tbody.innerHTML = state.problems.map(p => {
    const key = `${p.contestId}_${p.index}`;
    const isActive = state.activeProblemId === key;

    // Verdict display matching Codeforces Status page
    let verdictHtml;
    if (isActive) {
      verdictHtml = `<span class="verdict-active">In progress</span>`;
    } else if (p.status === "completed") {
      verdictHtml = `<span class="verdict-accepted">Accepted</span>`;
    } else {
      verdictHtml = `<span class="verdict-queued">In queue</span>`;
    }

    const isHidden = isProblemTimeHidden(p.contestId, p.index);
    const timeFormatted = isHidden
      ? "--"
      : ((p.timeSpentSeconds && p.timeSpentSeconds > 0)
        ? formatDuration(p.timeSpentSeconds)
        : "0 ms");

    return `
      <tr class="queue-row ${isActive ? "active-row" : ""}">
        <td class="col-cf-id">
          <a href="${safeHref(p.url)}" target="_blank" rel="noopener">${escapeHtml(`${p.contestId}${p.index}`)}</a>
        </td>
        <td class="col-cf-when">
          ${formatCfTimestamp(p.addedAt)}
        </td>
        <td class="col-cf-problem">
          <a href="${safeHref(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.index)} - ${escapeHtml(p.name)}</a>
        </td>
        <td class="col-cf-rating ${ratingColorClass(p.rating)}">${p.rating ?? "—"}</td>
        <td class="col-cf-verdict">${verdictHtml}</td>
        <td class="col-cf-time" style="text-align: center;">${timeFormatted}</td>
        <td class="col-cf-action">
          ${isActive
            ? `<span class="cf-badge-active">● Active</span>`
            : `<button type="button" class="cf-dark-btn btn-solve-now" data-key="${escapeAttribute(key)}">Solve now</button>`
          }
          <button type="button" class="cf-dark-btn-remove btn-remove-problem" data-key="${escapeAttribute(key)}" title="Remove from queue">✕</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-solve-now").forEach(btn => {
    btn.addEventListener("click", async () => {
      const target = state.problems.find(p => `${p.contestId}_${p.index}` === btn.dataset.key);
      if (target) {
        await setActiveProblem(target, { autoStartTimer: true });
      }
    });
  });

  tbody.querySelectorAll(".btn-remove-problem").forEach(btn => {
    btn.addEventListener("click", () => {
      removeProblemFromQueue(btn.dataset.key);
    });
  });
}

async function removeProblemFromQueue(key) {
  const [contestId, index] = key.split("_");
  const wasActive = state.activeProblemId === key;
  if (wasActive) {
    pauseTimer();
    state.activeProblemId = null;
  }

  // 1. Delete from database
  try {
    const res = await fetch(`/api/queue/${contestId}/${index}`, { method: "DELETE" });
    if (res.ok) {
      state.problems = await res.json();
    } else {
      state.problems = state.problems.filter(p => `${p.contestId}_${p.index}` !== key);
    }
  } catch (_) {
    state.problems = state.problems.filter(p => `${p.contestId}_${p.index}` !== key);
  }

  // 2. Clear localStorage for this problem
  clearLocalStorageForProblem(key);

  // 3. If queue got emptied, completely empty queue data from both DB and localStorage
  if (!state.problems.length) {
    clearLocalStorageQueueData();
    try {
      fetch("/api/queue", { method: "DELETE" });
    } catch (_) {}
  } else if (wasActive) {
    await setActiveProblem(state.problems[0], { autoStartTimer: false });
  } else {
    saveQueueState();
  }

  renderProblemViews();
}

async function clearQueue() {
  pauseTimer();
  state.activeProblemId = null;
  state.problems = [];

  // 1. Clear database
  try {
    await fetch("/api/queue", { method: "DELETE" });
  } catch (_) {}

  // 2. Clear all queue, active session, and draft data from localStorage
  clearLocalStorageQueueData();

  renderProblemViews();
}

function parseMultipleProblems(rawInput) {
  if (!rawInput) return [];
  const tokens = String(rawInput)
    .split(/[\n,;]+|\s+(?=https?:\/\/|\b\d+[A-Za-z])/i)
    .map(t => t.trim())
    .filter(Boolean);

  const results = [];
  const seen = new Set();

  for (const token of tokens) {
    const parsed = parseCodeforcesUrl(token);
    if (parsed) {
      const key = `${parsed.contestId}_${parsed.index}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(parsed);
      }
    }
  }

  return results;
}

async function setActiveProblem(targetProblem, { autoStartTimer = true } = {}) {
  // If another problem was running, pause and sync its time to DB
  if (state.activeProblemId && state.problem) {
    pauseTimer();
    syncActiveProblemTimeToDb();
  }

  const key = `${targetProblem.contestId}_${targetProblem.index}`;
  state.activeProblemId = key;

  state.problems.forEach(p => {
    if (`${p.contestId}_${p.index}` === key) {
      p.status = "active";
    } else if (p.status === "active") {
      p.status = "queued";
    }
  });

  // Sync active status to database
  try {
    fetch("/api/queue/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contestId: targetProblem.contestId, index: targetProblem.index })
    });
  } catch (_) {}

  renderProblemViews();

  // Check if an existing reflection is already saved in DB for this problem
  const hasPrevious = await restoreReflection();

  if (!hasPrevious) {
    if (autoStartTimer) {
      startTimer();
    } else {
      pauseTimer();
    }
  } else {
    pauseTimer({ clearWasSolving: true });
  }

  saveQueueState();
  renderProblemViews();
}

async function loadProblem(rawInput, { redirect = true, autoStartTimer = true } = {}) {
  const parsedList = parseMultipleProblems(rawInput);

  if (!parsedList.length) {
    showMessage("Please enter one or more valid Codeforces problem codes or URLs (e.g. 1904A, 1904B).", true);
    navigate("/load", { replace: true });
    return;
  }

  document.getElementById("problem-url").value = rawInput;

  const button = document.querySelector("#problem-form .btn");
  if (button) {
    button.disabled = true;
    button.textContent = "Loading…";
  }
  clearMessage();

  let loadedCount = 0;
  const errors = [];
  let firstActivatedKey = null;
  const newlyAdded = [];

  // Problems that already have a reflection have left the queue for good
  let reflectedKeys = new Set();
  try {
    const res = await fetch("/api/reflections");
    if (res.ok) {
      reflectedKeys = new Set((await res.json()).map(r => `${r.contestId}_${r.problemIndex}`));
    }
  } catch (_) {}

  for (const item of parsedList) {
    const key = `${item.contestId}_${item.index}`;
    if (reflectedKeys.has(key)) {
      errors.push(`${item.contestId}${item.index}: already reflected. Edit it from Progress instead.`);
      continue;
    }

    const alreadyQueued = state.problems.find(p => `${p.contestId}_${p.index}` === key);
    if (alreadyQueued) {
      loadedCount++;
      if (!firstActivatedKey) firstActivatedKey = key;
      continue;
    }

    try {
      const response = await fetch(`/api/problems/${item.contestId}/${item.index}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(`${item.contestId}${item.index}: ${data.error || "Not found"}`);
      }

      data.timeSpentSeconds = 0;
      data.timerRunning = false;
      data.status = (!state.activeProblemId && newlyAdded.length === 0) ? "active" : "queued";
      data.addedAt = new Date().toISOString();

      newlyAdded.push(data);
      loadedCount++;
      if (!firstActivatedKey) firstActivatedKey = key;
    } catch (err) {
      errors.push(err.message);
    }
  }

  // Persist newly added problems to database queue
  if (newlyAdded.length) {
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newlyAdded)
      });
      const data = await res.json();
      if (res.ok) {
        state.problems = data;
      } else {
        errors.push(data.error || "Could not add problems to the queue.");
      }
    } catch (_) {
      errors.push("Could not add problems to the queue.");
    }
    const storedKeys = new Set(state.problems.map(p => `${p.contestId}_${p.index}`));
    loadedCount -= newlyAdded.filter(p => !storedKeys.has(`${p.contestId}_${p.index}`)).length;
    if (firstActivatedKey && !storedKeys.has(firstActivatedKey)) {
      firstActivatedKey = [...storedKeys][0] || null;
    }
  }

  if (errors.length) {
    showMessage(errors.join(" · "), loadedCount === 0);
  }

  if (!loadedCount) {
    if (button) {
      button.disabled = false;
      button.textContent = "Load Problem(s)";
    }
    return;
  }

  // If no problem is currently active, activate the first loaded problem
  if (!state.activeProblemId && firstActivatedKey) {
    const target = state.problems.find(p => `${p.contestId}_${p.index}` === firstActivatedKey);
    if (target) {
      await setActiveProblem(target, { autoStartTimer });
    }
  } else {
    renderProblemViews();
  }

  saveQueueState();

  if (button) {
    button.disabled = false;
    button.textContent = "Load Problem(s)";
  }

  if (redirect) {
    navigate("/problem");
  }
}

function renderReflectionTags(tags) {
  const list = tags && tags.length ? tags : (state.problem?.tags || []);
  const html = list.length
    ? `<div class="tags-list">${list.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : `<span class="readonly">—</span>`;

  for (const id of ["view-tags", "form-view-tags"]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
}

async function restoreReflection() {
  if (!state.problem) return false;
  const { contestId, index } = state.problem;

  for (let i = 0; i < 5; i++) {
    const qEl = document.getElementById(`q${i}`);
    if (qEl) qEl.value = "";
    const viewEl = document.getElementById(`view-q${i}`);
    if (viewEl) viewEl.innerHTML = "";
  }
  renderReflectionTags(state.problem?.tags);
  setSaveStatus("");
  const reasonSelect = document.getElementById("q-stuck-reason");
  if (reasonSelect) reasonSelect.value = "";

  try {
    const response = await fetch(`/api/reflections/${contestId}/${index}`);

    if (!response.ok) {
      let hasDraft = false;
      try {
        const draftRaw = localStorage.getItem(
          STORAGE_KEYS.DRAFT_PREFIX + `${contestId}_${index}`
        );
        if (draftRaw) {
          const draft = JSON.parse(draftRaw);
          if (Array.isArray(draft) && draft.some(Boolean)) {
            draft.slice(0, 5).forEach((val, i) => {
              const qEl = document.getElementById(`q${i}`);
              if (qEl) qEl.value = val;
            });
            if (reasonSelect && draft[5]) reasonSelect.value = draft[5];
            hasDraft = true;
          }
        }
      } catch (_) {}

      updateTimer();
      setReflectionMode("edit"); // In-progress solve session -> open in edit mode
      if (hasDraft) {
        setSaveStatus("Unsaved draft restored.");
      }
      return false;
    }

    const reflection = await response.json();

    const answers = [
      reflection.keyObservation,
      reflection.whatMadeMeStuck,
      reflection.pattern,
      reflection.futureTrigger,
      reflection.simplestImplementation
    ];

    answers.forEach((answer, i) => {
      const qEl = document.getElementById(`q${i}`);
      if (qEl) qEl.value = answer;

      const viewEl = document.getElementById(`view-q${i}`);
      if (viewEl) {
        viewEl.innerHTML = (i === 4)
          ? renderCodeOnly(answer)
          : (i === 1 ? stuckReasonChip(reflection.stuckReason) : "") + renderMarkdown(answer);
      }
    });
    if (reasonSelect) reasonSelect.value = reflection.stuckReason || "";

    renderReflectionTags(reflection.tags);

    const viewProblemLink = document.getElementById("view-problem-link");
    if (viewProblemLink && state.problem) {
      viewProblemLink.href = safeHref(state.problem.url) === "#" ? "#" : state.problem.url;
      viewProblemLink.textContent = `${state.problem.url} ↗`;
    }

    state.timerSeconds = reflection.timeSpentSeconds;
    updateTimer();
    pauseTimer({ clearWasSolving: true }); // Existing reflection -> timer MUST stay paused!
    setSaveStatus("Previous reflection restored.");
    setReflectionMode("view"); // Saved reflection -> open in clean view table
    return true;
  } catch (_) {
    // On network/fetch error: preserve in-progress timer and open edit mode
    updateTimer();
    setReflectionMode("edit");
    return false;
  }
}

function renderProblem() {
  const p = state.problem;

  document.getElementById("problem-title").innerHTML =
    `<a href="${safeHref(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a>`;

  const rating = document.getElementById("problem-rating");
  rating.textContent = p.rating ?? "Unrated";
  rating.className = `readonly ${ratingColorClass(p.rating)}`;

  document.getElementById("problem-contest-id").textContent = String(p.contestId);
  document.getElementById("problem-index").textContent = p.index;

  syncProblemViews();
}

function startTimer() {
  clearInterval(state.timerHandle);
  state.timerRunning = true;
  if (state.problem) {
    state.problem.wasSolving = true;
  }

  const now = Date.now();
  lastTickTimestamp = now;
  saveTimerState();

  const pauseBtn = document.getElementById("pause-btn");
  if (pauseBtn) pauseBtn.textContent = "Pause";

  state.timerHandle = setInterval(() => {
    if (!state.timerRunning) return;
    const currentNow = Date.now();
    if (!lastTickTimestamp) lastTickTimestamp = currentNow;

    const delta = Math.floor((currentNow - lastTickTimestamp) / 1000);
    if (delta >= 1) {
      state.timerSeconds += delta;
      lastTickTimestamp += delta * 1000;
      updateTimer();
      saveTimerState();

      // Periodic auto-sync to the database every 10 seconds
      if (currentNow - lastDbSyncTime >= 10000) {
        lastDbSyncTime = currentNow;
        syncActiveProblemTimeToDb();
      }
    }
  }, 1000);
}

function pauseTimer({ clearWasSolving = false } = {}) {
  clearInterval(state.timerHandle);
  state.timerHandle = null;

  if (state.timerRunning) {
    reconcileElapsedTime();
  }

  state.timerRunning = false;
  if (clearWasSolving && state.problem) {
    state.problem.wasSolving = false;
  }

  saveTimerState();
  syncActiveProblemTimeToDb();

  const pauseBtn = document.getElementById("pause-btn");
  if (pauseBtn) pauseBtn.textContent = "Resume";
}

function updateTimer() {
  const isHidden = state.problem && isProblemTimeHidden(state.problem.contestId, state.problem.index);

  const h = Math.floor(state.timerSeconds / 3600);
  const m = Math.floor((state.timerSeconds % 3600) / 60);
  const s = state.timerSeconds % 60;

  const formatted = isHidden
    ? "--"
    : [h, m, s].map(value => String(value).padStart(2, "0")).join(":");

  for (const id of ["timer", "practice-timer", "practice-page-timer"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = formatted;
  }
}

async function saveReflection(event) {
  event.preventDefault();

  if (!state.problem) {
    setSaveStatus("Load a problem before saving a reflection.", true);
    navigate("/load");
    return;
  }

  const answers = [0, 1, 2, 3, 4].map(i =>
    document.getElementById(`q${i}`).value.trim()
  );

  if (answers.some(answer => !answer)) {
    setSaveStatus("Please answer all five questions.", true);
    return;
  }

  const stuckReason = document.getElementById("q-stuck-reason")?.value || "";
  if (!stuckReason) {
    setSaveStatus("Please select the main reason you got stuck.", true);
    document.getElementById("q-stuck-reason")?.focus();
    return;
  }

  const payload = {
    contestId: state.problem.contestId,
    problemIndex: state.problem.index,
    problemName: state.problem.name,
    rating: state.problem.rating,
    tags: state.problem.tags,
    problemUrl: state.problem.url,
    timeSpentSeconds: state.timerSeconds,
    keyObservation: answers[0],
    whatMadeMeStuck: answers[1],
    stuckReason,
    pattern: answers[2],
    futureTrigger: answers[3],
    simplestImplementation: answers[4]
  };

  try {
    const response = await fetch("/api/reflections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      setSaveStatus(data.error || "Could not save reflection.", true);
      if (response.status === 409) await refreshQueueFromDb();
      return;
    }

    const savedKey = `${state.problem.contestId}_${state.problem.index}`;

    // 1. Remove draft from localStorage for this problem
    try {
      localStorage.removeItem(STORAGE_KEYS.DRAFT_PREFIX + savedKey);
    } catch (_) {}

    // 2. Clear inputs and view fields
    for (let i = 0; i < 5; i++) {
      const qEl = document.getElementById(`q${i}`);
      if (qEl) qEl.value = "";
      const viewEl = document.getElementById(`view-q${i}`);
      if (viewEl) viewEl.innerHTML = "";
    }
    const reasonSelectEl = document.getElementById("q-stuck-reason");
    if (reasonSelectEl) reasonSelectEl.value = "";
    setSaveStatus("");

    // 3. Clear active solve session & timer completely
    pauseTimer();
    updateTimer();

    // 4. Remove problem completely from the queue, DB, and localStorage
    state.activeProblemId = null;
    try {
      await fetch(`/api/queue/${state.problem.contestId}/${state.problem.index}`, { method: "DELETE" });
    } catch (_) {}
    state.problems = state.problems.filter(p => `${p.contestId}_${p.index}` !== savedKey);

    clearLocalStorageForProblem(savedKey);

    if (!state.problems.length) {
      clearLocalStorageQueueData();
      try {
        fetch("/api/queue", { method: "DELETE" });
      } catch (_) {}
    } else {
      saveQueueState();
    }
    syncProblemViews();

    // 5. Update history and navigate to progress page
    await loadHistory();
    navigate("/progress");
  } catch (_) {
    setSaveStatus("Could not save reflection. Please try again.", true);
  }
}

let journalCache = [];
let journalFilterState = {
  search: "",
  ratingCategory: "all",
  minRating: "",
  maxRating: "",
  tag: "all",
  reason: "",
  sortBy: "recent-solves"
};
let journalFiltersInitialized = false;

// Progress table pagination. The page resets to 1 whenever a filter or the
// sort order changes; reloading data or toggling time keeps the current page.
const JOURNAL_PAGE_SIZES = [10, 20, 50, 100];
const JOURNAL_PAGE_SIZE_KEY = "cr_progress_page_size";
let journalPageSize = 20;
try {
  const saved = Number(localStorage.getItem(JOURNAL_PAGE_SIZE_KEY));
  if (JOURNAL_PAGE_SIZES.includes(saved)) journalPageSize = saved;
} catch (_) {}
let journalPage = 1;
let lastJournalFilterKey = null;

// Page numbers to show: first, last, and a window around the current page
function paginationItems(current, total) {
  const pages = new Set([1, total]);
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const items = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push("…");
    items.push(p);
  });
  return items;
}

function buildPagination(current, total, label = "Reflections pages") {
  if (total <= 1) return "";
  const arrow = (label, page, disabled, aria) => disabled
    ? `<span class="cf-page is-disabled" aria-hidden="true">${label}</span>`
    : `<a href="#" class="cf-page" data-page="${page}" aria-label="${aria}">${label}</a>`;
  return `
    <nav class="cf-pagination" aria-label="${label}">
      ${arrow("←", current - 1, current === 1, "Previous page")}
      ${paginationItems(current, total).map(item => item === "…"
        ? `<span class="cf-page-gap">…</span>`
        : item === current
          ? `<span class="cf-page is-active" aria-current="page">${item}</span>`
          : `<a href="#" class="cf-page" data-page="${item}">${item}</a>`).join("")}
      ${arrow("→", current + 1, current === total, "Next page")}
    </nav>`;
}

async function loadHistory() {
  setupProgressFilterListeners();
  try {
    const response = await fetch("/api/reflections");

    if (!response.ok) {
      renderJournalEmpty("Could not load your journal right now.");
      updateSidebar([]);
      return;
    }

    journalCache = await response.json();
    populateProgressTagFilter(journalCache);
    applyJournalFilters();
    updateSidebar(journalCache);
    renderDashboard(journalCache);
    renderWeakSpotsPage(journalCache);
  } catch (_) {
    renderJournalEmpty("Could not load your journal right now.");
    updateSidebar([]);
    renderDashboard([]);
  }
}

// ==========================================================================
// Home Dashboard
// ==========================================================================

// ==========================================================================
// Review Mode (spaced repetition)
// ==========================================================================

const REVIEW_GRADES = [
  { grade: "forgot", label: "Forgot", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "remembered", label: "Remembered", key: "3" }
];

let reviewSession = null;

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function isReviewDue(state) {
  return new Date(state.dueAt) <= endOfToday();
}

// Mirrors nextState() in src/repositories/reviewRepository.js
function nextReviewDays(state, grade, intervals) {
  if (grade === "remembered") return intervals[Math.min(state.stage + 1, intervals.length - 1)];
  if (grade === "hard") return Math.max(1, Math.round(intervals[state.stage] / 2));
  return intervals[0];
}

function formatInDays(days) {
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

function formatDueDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// Review states joined with their reflections (skips states whose reflection is gone)
async function fetchReviewData() {
  const [reviewsRes, reflectionsRes] = await Promise.all([fetch("/api/reviews"), fetch("/api/reflections")]);
  if (!reviewsRes.ok || !reflectionsRes.ok) throw new Error("Could not load reviews.");
  const { intervals, reviews } = await reviewsRes.json();
  const byId = new Map((await reflectionsRes.json()).map(r => [r.id, r]));
  const items = reviews
    .filter(state => byId.has(state.reflectionId))
    .map(state => ({ ...state, reflection: byId.get(state.reflectionId) }));
  return { intervals, items };
}

async function loadReviewView() {
  const body = document.getElementById("review-body");
  if (!body) return;
  body.innerHTML = `<p class="dash-muted">Loading…</p>`;

  try {
    const { intervals, items } = await fetchReviewData();
    const queue = items
      .filter(isReviewDue)
      .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
    reviewSession = {
      intervals,
      items,
      queue,
      position: 0,
      revealed: false,
      recall: "",
      busy: false,
      results: { forgot: 0, hard: 0, remembered: 0 }
    };
  } catch (_) {
    reviewSession = null;
    body.innerHTML = `<p class="dash-muted">Could not load your review schedule. Please try again.</p>`;
    return;
  }

  renderReviewCard();
  renderReviewSchedule();
}

function renderReviewCard() {
  const body = document.getElementById("review-body");
  const caption = document.getElementById("review-caption");
  if (!body || !reviewSession) return;
  const { queue, position, revealed, intervals, results } = reviewSession;

  // Nothing was due
  if (!queue.length) {
    caption.textContent = "Review session";
    const upcoming = [...reviewSession.items].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
    body.innerHTML = reviewSession.items.length
      ? `<p><b>All caught up.</b> Nothing is due for review today.</p>
         <p class="dash-muted">Next review: ${formatDueDate(upcoming.dueAt)} (${problemCode(upcoming.reflection)} ${escapeHtml(upcoming.reflection.problemName)}).</p>`
      : `<p>No reflections yet. Reflections become due for review one day after you solve the problem.</p>
         <p><a href="/load" data-route="load">Load a problem →</a></p>`;
    return;
  }

  // Session finished
  if (position >= queue.length) {
    caption.textContent = "Review session complete";
    const reviewed = results.forgot + results.hard + results.remembered;
    body.innerHTML = `
      <p><b>Done: ${reviewed} reflection${reviewed === 1 ? "" : "s"} reviewed.</b></p>
      <table class="dash-table dash-weak-table review-summary"><tbody>
        <tr><td class="dash-count">${results.remembered}</td><td>Remembered — coming back later</td></tr>
        <tr><td class="dash-count">${results.hard}</td><td>Hard — coming back sooner</td></tr>
        <tr><td class="dash-count">${results.forgot}</td><td>Forgot — coming back tomorrow</td></tr>
      </tbody></table>
      <p style="margin-top: 12px;"><a class="btn" href="/" data-route="home">Back to dashboard</a></p>`;
    return;
  }

  const item = queue[position];
  const r = item.reflection;
  caption.textContent = `Review session — ${position + 1} of ${queue.length}`;

  const history = item.reviews
    ? `reviewed ${item.reviews} time${item.reviews === 1 ? "" : "s"}${item.lapses ? `, forgotten ${item.lapses}` : ""}`
    : "first review";

  const reveal = revealed
    ? `
      <table class="info-table review-answer">
        <tbody>
          <tr><th>Key observation</th><td class="markdown-body">${renderMarkdown(r.keyObservation)}</td></tr>
          <tr><th>What made me stuck</th><td class="markdown-body">${stuckReasonChip(r.stuckReason)}${renderMarkdown(r.whatMadeMeStuck)}</td></tr>
          <tr><th>Pattern</th><td class="markdown-body">${renderMarkdown(r.pattern)}</td></tr>
          <tr><th>Future trigger</th><td class="markdown-body">${renderMarkdown(r.futureTrigger)}</td></tr>
          <tr><th>Simplest implementation</th><td><details class="review-code"><summary>Show code</summary><div class="markdown-body spoiler-code-content">${renderCodeOnly(r.simplestImplementation)}</div></details></td></tr>
          <tr><th>Tags</th><td>${(r.tags || []).length ? r.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(" ") : "—"}</td></tr>
        </tbody>
      </table>
      <p class="review-grade-question">How well did you remember it?</p>
      <div class="review-grades">
        ${REVIEW_GRADES.map(g => `
          <button type="button" class="btn review-grade-btn" data-grade="${g.grade}">
            ${g.label} <span class="review-grade-next">${formatInDays(nextReviewDays(item, g.grade, intervals))}</span>
            <kbd>${g.key}</kbd>
          </button>`).join("")}
      </div>`
    : `<p><button type="button" class="btn" id="review-reveal-btn">Reveal reflection <kbd>Space</kbd></button></p>`;

  body.innerHTML = `
    <div class="review-problem">
      <a href="${safeHref(r.problemUrl)}" target="_blank" rel="noopener">${problemCode(r)}</a>
      <a href="${safeHref(r.problemUrl)}" target="_blank" rel="noopener" class="review-problem-name">${escapeHtml(r.problemName)}</a>
      <span class="${ratingColorClass(r.rating)}">${r.rating ?? "—"}</span>
    </div>
    <div class="dash-muted review-meta">Solved ${formatSavedDate(r.createdAt || r.updatedAt)} · ${history}</div>

    <p class="review-instructions">Re-read the statement if you need to, then answer from memory:</p>
    <ol class="review-prompts">
      <li>What was the key observation?</li>
      <li>What made you stuck?</li>
      <li>What should make you think of this idea next time?</li>
    </ol>
    <textarea id="review-recall" class="cf-textarea review-recall" rows="3" placeholder="Jot down what you remember (optional, not saved)"></textarea>
    <p class="review-error hidden" id="review-error"></p>
    ${reveal}`;

  const recallEl = document.getElementById("review-recall");
  recallEl.value = reviewSession.recall;
  recallEl.addEventListener("input", () => { reviewSession.recall = recallEl.value; });

  document.getElementById("review-reveal-btn")?.addEventListener("click", revealReview);
  body.querySelectorAll(".review-grade-btn").forEach(btn => {
    btn.addEventListener("click", () => gradeReview(btn.dataset.grade));
  });
}

function revealReview() {
  if (!reviewSession || reviewSession.revealed) return;
  reviewSession.revealed = true;
  renderReviewCard();
}

async function gradeReview(grade) {
  if (!reviewSession || !reviewSession.revealed || reviewSession.busy) return;
  const item = reviewSession.queue[reviewSession.position];
  if (!item) return;

  reviewSession.busy = true;
  try {
    const res = await fetch(`/api/reviews/${item.reflectionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grade })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save review.");

    Object.assign(item, data);
    reviewSession.results[grade]++;
    reviewSession.position++;
    reviewSession.revealed = false;
    reviewSession.recall = "";
    renderReviewCard();
    renderReviewSchedule();
    window.scrollTo({ top: 0 });
  } catch (err) {
    const errEl = document.getElementById("review-error");
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  } finally {
    reviewSession.busy = false;
  }
}

function renderReviewSchedule() {
  const el = document.getElementById("review-schedule");
  if (!el || !reviewSession) return;

  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const today = startOfDay(new Date());
  const dayDiff = iso => Math.round((startOfDay(iso) - today) / 86400000);

  const buckets = { today: 0, tomorrow: 0, week: 0, later: 0 };
  let longTerm = 0;
  for (const item of reviewSession.items) {
    const diff = dayDiff(item.dueAt);
    if (diff <= 0) buckets.today++;
    else if (diff === 1) buckets.tomorrow++;
    else if (diff <= 7) buckets.week++;
    else buckets.later++;
    if (reviewSession.intervals[item.stage] >= 30) longTerm++;
  }

  el.innerHTML = `
    <table class="dash-table dash-weak-table review-schedule-table"><tbody>
      <tr><td class="dash-count">${buckets.today}</td><td>Due today</td></tr>
      <tr><td class="dash-count">${buckets.tomorrow}</td><td>Due tomorrow</td></tr>
      <tr><td class="dash-count">${buckets.week}</td><td>Due in the next 7 days</td></tr>
      <tr><td class="dash-count">${buckets.later}</td><td>Due later</td></tr>
    </tbody></table>
    <p class="dash-note">Intervals: ${reviewSession.intervals.join(" → ")} days. Remembered moves a reflection one step further out, Hard repeats at half the gap, Forgot resets it to tomorrow. ${longTerm} reflection${longTerm === 1 ? " is" : "s are"} on a 30+ day interval.</p>`;
}

// Keyboard: Space/Enter reveals, 1/2/3 grades (ignored while typing)
document.addEventListener("keydown", event => {
  const page = document.querySelector('.app-page[data-page="review"]');
  if (!reviewSession || !page || page.classList.contains("hidden")) return;
  if (event.target.closest("input, textarea, select, [contenteditable]")) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (!reviewSession.revealed && (event.key === " " || event.key === "Enter")) {
    if (event.target.closest("a, button") && event.key === "Enter") return;
    event.preventDefault();
    revealReview();
    return;
  }
  const match = REVIEW_GRADES.find(g => g.key === event.key);
  if (match && reviewSession.revealed) {
    event.preventDefault();
    gradeReview(match.grade);
  }
});

async function renderDashboardReviews() {
  const countEl = document.getElementById("dash-due-count");
  const el = document.getElementById("dash-review");
  if (!el || !countEl) return;
  try {
    const { items } = await fetchReviewData();
    const due = items.filter(isReviewDue);
    countEl.textContent = due.length;
    if (due.length) {
      el.innerHTML = `<a class="btn btn-sm" href="/review" data-route="review">Start review →</a>`;
    } else if (items.length) {
      const next = [...items].sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
      el.innerHTML = `<span class="dash-muted">Next review: ${formatDueDate(next.dueAt)}</span>`;
    } else {
      el.innerHTML = "";
    }
  } catch (_) {
    countEl.textContent = "—";
    el.innerHTML = "";
  }
}

// Keyword rules that map free-text "stuck" answers onto recurring reasons.
const STUCK_REASONS = [
  { key: "constraints", label: "Didn't read the constraints closely", re: /constraint/i },
  { key: "edge-cases", label: "Missed edge cases", re: /edge ?cases?|corner ?cases?/i },
  { key: "wrong-technique", label: "Picked the wrong technique", re: /wrong (technique|approach|idea|method)|applied wrong/i },
  { key: "misread", label: "Misread or rushed the statement", re: /\bread\b|\breading\b|statement|misread|misunderst/i },
  { key: "intimidated", label: "Intimidated by the problem", re: /scare|afraid|panic|intimidat/i },
  { key: "bugs", label: "Implementation bugs", re: /\bbug|overflow|off[- ]by[- ]one/i }
];

function matchesStuckReason(item, reason) {
  return reason.re.test(`${item.whatMadeMeStuck}\n${item.futureTrigger}`);
}

// Full list of stuck reasons, loaded from GET /api/stuck-reasons (key -> label)
const stuckReasonLabels = new Map();
let stuckReasonGroups = [];

function stuckReasonLabel(key) {
  return stuckReasonLabels.get(key) || STUCK_REASONS.find(r => r.key === key)?.label || key;
}

// The reason picked on the form; older reflections without one fall back to
// keyword detection on their "stuck" and "trigger" answers.
function stuckReasonKeysOf(item) {
  if (item.stuckReason) return [item.stuckReason];
  return STUCK_REASONS.filter(reason => matchesStuckReason(item, reason)).map(reason => reason.key);
}

function stuckReasonChip(key) {
  return key
    ? `<div class="stuck-reason-chip">Reason: <b>${escapeHtml(stuckReasonLabel(key))}</b></div>`
    : "";
}

async function loadStuckReasons() {
  try {
    const res = await fetch("/api/stuck-reasons");
    if (!res.ok) return;
    const groups = await res.json();
    stuckReasonGroups = groups;
    stuckReasonLabels.clear();
    const optionsHtml = groups.map(group => `
      <optgroup label="${escapeAttribute(group.group)}">
        ${group.reasons.map(reason => {
          stuckReasonLabels.set(reason.key, reason.label);
          return `<option value="${escapeAttribute(reason.key)}">${escapeHtml(reason.label)}</option>`;
        }).join("")}
      </optgroup>`).join("");
    for (const id of ["q-stuck-reason", "edit-stuck-reason"]) {
      const select = document.getElementById(id);
      if (!select) continue;
      const placeholder = select.querySelector('option[value=""]')?.outerHTML || "";
      const current = select.value;
      select.innerHTML = placeholder + optionsHtml;
      select.value = current;
    }
  } catch (_) {}
}

function problemCode(item) {
  return escapeHtml(`${item.contestId}${item.problemIndex}`);
}

function solvedAtOf(item) {
  return new Date(item.createdAt || item.updatedAt);
}

// Stuck Reasons and Tags by Time pages: the complete lists behind the
// dashboard's top-4 boxes
function renderWeakSpotsPage(items) {
  const reasonsEl = document.getElementById("weak-reasons-body");
  const tagsEl = document.getElementById("weak-tags-body");
  if (!reasonsEl || !tagsEl) return;

  const codesHtml = problems => problems
    .sort((a, b) => solvedAtOf(b) - solvedAtOf(a))
    .map(item => `<a href="${safeHref(item.problemUrl)}" target="_blank" rel="noopener">${problemCode(item)}</a>`)
    .join(", ");

  // Stuck reasons: every reason from the catalogue, grouped, with its problems
  const byReason = new Map();
  for (const item of items) {
    for (const key of stuckReasonKeysOf(item)) {
      if (!byReason.has(key)) byReason.set(key, []);
      byReason.get(key).push(item);
    }
  }
  const groups = stuckReasonGroups.length
    ? stuckReasonGroups
    : [{ group: "Detected reasons", reasons: STUCK_REASONS.map(({ key, label }) => ({ key, label })) }];
  const used = [...byReason.keys()].length;
  document.getElementById("weak-reasons-caption").textContent =
    `All stuck reasons (${used} of ${groups.reduce((n, g) => n + g.reasons.length, 0)} used)`;

  reasonsEl.innerHTML = `
    <table class="weak-table">
      <thead><tr><th>Reason</th><th class="weak-num">Problems</th><th>Which ones</th></tr></thead>
      <tbody>
        ${groups.map(group => {
          const count = group.reasons.reduce((n, r) => n + (byReason.get(r.key)?.length || 0), 0);
          return `
            <tr class="weak-group-row"><td colspan="3">${escapeHtml(group.group)} <span class="dash-muted">(${count})</span></td></tr>
            ${group.reasons.map(reason => {
              const problems = byReason.get(reason.key) || [];
              return problems.length
                ? `<tr>
                     <td><a href="/progress?reason=${escapeAttribute(reason.key)}" data-route="progress">${escapeHtml(reason.label)}</a></td>
                     <td class="weak-num"><b>${problems.length}</b></td>
                     <td class="weak-codes">${codesHtml(problems)}</td>
                   </tr>`
                : `<tr class="weak-unused">
                     <td>${escapeHtml(reason.label)}</td>
                     <td class="weak-num">0</td>
                     <td></td>
                   </tr>`;
            }).join("")}`;
        }).join("")}
      </tbody>
    </table>`;

  // Tags: every tag, slowest average first
  const byTag = new Map();
  for (const item of items) {
    for (const tag of item.tags || []) {
      const entry = byTag.get(tag) || { tag, problems: [], seconds: 0 };
      entry.problems.push(item);
      entry.seconds += item.timeSpentSeconds || 0;
      byTag.set(tag, entry);
    }
  }
  const tags = [...byTag.values()].sort((a, b) =>
    (b.seconds / b.problems.length - a.seconds / a.problems.length) || a.tag.localeCompare(b.tag));
  document.getElementById("weak-tags-caption").textContent = `All tags (${tags.length})`;

  tagsEl.innerHTML = tags.length
    ? `<table class="weak-table">
        <thead><tr><th>Tag</th><th class="weak-num">Problems</th><th class="weak-num">Avg time</th><th class="weak-num">Total</th><th>Which ones</th></tr></thead>
        <tbody>
          ${tags.map(entry => `
            <tr${entry.problems.length < 2 ? ' class="weak-single"' : ""}>
              <td><a href="/progress?tag=${encodeURIComponent(entry.tag)}" data-route="progress">${escapeHtml(entry.tag)}</a>${entry.problems.length < 2 ? ' <span class="dash-muted">(1 problem)</span>' : ""}</td>
              <td class="weak-num">${entry.problems.length}</td>
              <td class="weak-num"><b>${formatDuration(Math.round(entry.seconds / entry.problems.length))}</b></td>
              <td class="weak-num">${formatDuration(entry.seconds)}</td>
              <td class="weak-codes">${codesHtml([...entry.problems])}</td>
            </tr>`).join("")}
        </tbody>
      </table>`
    : `<div class="dash-empty dash-muted">No tags yet.</div>`;
}

// Activity heatmap on the dashboard: one square per day (columns are weeks,
// Sunday on top), coloured by problems solved or time spent that day. Like
// GitHub, the four greens are relative: they split the active days of the
// period shown into quarters, so the busiest days are always the darkest.
const HEAT_KEYS = { metric: "cr_heat_metric", period: "cr_heat_period" };
const DAY_MS = 24 * 60 * 60 * 1000;
let heatItems = [];
let heatDays = new Map();

function heatPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
}

function setHeatPref(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

// Local calendar day, e.g. "2026-10-05"
function dayKey(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// { problems, seconds, items } per day. Time of problems whose time is hidden
// (Manage → Hide time) is left out.
function groupByDay(items) {
  const days = new Map();
  for (const item of items) {
    const key = dayKey(solvedAtOf(item));
    const day = days.get(key) || { problems: 0, seconds: 0, timed: 0, ratingSum: 0, rated: 0, items: [] };
    const hidden = isProblemTimeHidden(item.contestId, item.problemIndex);
    day.problems += 1;
    if (item.rating != null && !isNaN(item.rating)) {
      day.ratingSum += Number(item.rating);
      day.rated += 1; // problems with a rating, for the average rating
    }
    if (!hidden) {
      day.seconds += item.timeSpentSeconds || 0;
      day.timed += 1; // problems whose time counts, for the average
    }
    day.items.push({ item, hidden });
    days.set(key, day);
  }
  return days;
}

// First and last day shown: the last 53 weeks, or one calendar year
function heatRange(period) {
  const today = startOfDay(new Date());
  if (period === "last") {
    const from = addDays(today, -today.getDay() - 52 * 7);
    return { from, to: today };
  }
  const year = Number(period);
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
}

function heatValue(day, metric) {
  if (!day) return 0;
  if (metric === "time") return day.seconds;
  // Average time per problem that day (problems with hidden time left out)
  if (metric === "avg") return day.timed ? Math.round(day.seconds / day.timed) : 0;
  // Average rating of the day's rated problems
  if (metric === "rating") return day.rated ? Math.round(day.ratingSum / day.rated) : 0;
  return day.problems;
}

// Distinct non-zero values, ascending. Quarters are taken over these, so a
// period where most active days have 1 problem still uses all four greens.
function heatSteps(values) {
  return [...new Set(values.filter(v => v > 0))].sort((a, b) => a - b);
}

// Quartile limits of the active days' values: level 1–4 for each active day
function heatLevels(values) {
  const sorted = heatSteps(values);
  if (!sorted.length) return () => 0;
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const limits = [at(0.25), at(0.5), at(0.75)];
  return value => {
    if (value <= 0) return 0;
    if (value <= limits[0]) return 1;
    if (value <= limits[1]) return 2;
    if (value <= limits[2]) return 3;
    return 4;
  };
}

function formatHeatValue(value, metric) {
  if (metric === "time" || metric === "avg") return formatDuration(value);
  return `${value} problem${value === 1 ? "" : "s"}`;
}

function renderActivity(items) {
  const grid = document.getElementById("heat-grid");
  if (!grid) return;
  heatItems = items;
  heatDays = groupByDay(items);

  const metricEl = document.getElementById("heat-metric");
  const periodEl = document.getElementById("heat-period");

  // Period choices: the last 12 months, then each year that has data
  const thisYear = new Date().getFullYear();
  const years = new Set([thisYear]);
  for (const key of heatDays.keys()) years.add(Number(key.slice(0, 4)));
  const savedPeriod = heatPref(HEAT_KEYS.period, "last");
  periodEl.innerHTML = `<option value="last">Last 12 months</option>` +
    [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join("");
  periodEl.value = [...periodEl.options].some(o => o.value === savedPeriod) ? savedPeriod : "last";
  const savedMetric = heatPref(HEAT_KEYS.metric, "problems");
  metricEl.value = ["time", "avg", "rating"].includes(savedMetric) ? savedMetric : "problems";

  if (!grid._initialized) {
    grid._initialized = true;
    metricEl.addEventListener("change", () => { setHeatPref(HEAT_KEYS.metric, metricEl.value); drawHeatmap(); });
    periodEl.addEventListener("change", () => { setHeatPref(HEAT_KEYS.period, periodEl.value); drawHeatmap(); });
    initHeatTooltip(grid);
    // Refit the squares when the card changes width (window resized, or the
    // dashboard shown after being hidden)
    let lastWidth = 0;
    new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width && width !== lastWidth) {
        lastWidth = width;
        drawHeatmap();
      }
    }).observe(document.getElementById("heat-scroll"));
  }
  drawHeatmap();
}

function drawHeatmap() {
  const grid = document.getElementById("heat-grid");
  const metric = document.getElementById("heat-metric").value;
  const period = document.getElementById("heat-period").value;
  const { from, to } = heatRange(period);
  const start = addDays(from, -from.getDay()); // the Sunday on or before `from`
  const weeks = Math.floor((to - start) / DAY_MS / 7) + 1;
  const today = startOfDay(new Date());

  const shown = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) shown.push(heatValue(heatDays.get(dayKey(d)), metric));
  const levelOf = heatLevels(shown);

  const parts = [];
  // Month names above the week in which each month starts
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const firstDay = addDays(start, w * 7);
    const day = firstDay < from ? from : firstDay;
    if (day.getMonth() !== lastMonth && day.getDate() <= 7) {
      lastMonth = day.getMonth();
      parts.push(`<span class="heat-month" style="grid-column:${w + 2}">${day.toLocaleDateString(undefined, { month: "short" })}</span>`);
    }
  }
  // Weekday labels (Mon / Wed / Fri). Every row gets a cell, plus one above
  // them, so the pinned label column covers the squares scrolling under it.
  const weekdayLabels = { 1: "Mon", 3: "Wed", 5: "Fri" };
  parts.push(`<span class="heat-wday" style="grid-row:1"></span>`);
  for (let dow = 0; dow < 7; dow++) {
    parts.push(`<span class="heat-wday" style="grid-row:${dow + 2}">${weekdayLabels[dow] || ""}</span>`);
  }
  for (let w = 0; w < weeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const date = addDays(start, w * 7 + dow);
      if (date < from || date > to) continue;
      const key = dayKey(date);
      const future = date > today;
      const value = future ? 0 : heatValue(heatDays.get(key), metric);
      // Average rating: the Codeforces rank colour of the day's average
      // (e.g. rating-cyan → heat-rank-cyan); other modes: green levels
      const shade = metric === "rating"
        ? (value ? `heat-${ratingColorClass(value).replace("rating-", "rank-")}` : "heat-l0")
        : `heat-l${future ? 0 : levelOf(value)}`;
      parts.push(`<button type="button" class="heat-cell ${shade}${future ? " heat-future" : ""}" style="grid-column:${w + 2};grid-row:${dow + 2}" data-day="${key}" aria-label="${key}"></button>`);
    }
  }
  // Squares fill the card's width (10–14px). Where the year doesn't fit
  // (phones), the grid scrolls sideways, and the squares are sized so a whole
  // number of weeks fills the view: the first and last visible columns then
  // sit exactly at the edges, like the legend and stats below.
  const scroll = document.getElementById("heat-scroll");
  const labelWidth = 30;
  const gap = 3;
  const available = scroll.clientWidth - labelWidth;
  const fit = Math.floor((available - weeks * gap) / weeks);
  let cell = Math.min(14, fit || 12);
  if (fit < 10) {
    const columns = Math.max(1, Math.floor((available + gap) / (10 + gap)));
    cell = (available + gap) / columns - gap;
  }
  grid.style.setProperty("--heat-cell", `${cell}px`);
  grid.style.gridTemplateColumns = `${labelWidth - gap}px repeat(${weeks}, var(--heat-cell))`;
  grid.innerHTML = parts.join("");

  // Legend and stats line up with the squares: from the first week column
  // to the last (or the visible width, when the grid scrolls on phones)
  const below = document.getElementById("heat-below");
  const gridWidth = grid.offsetWidth;
  const visibleWidth = scroll.clientWidth;
  // (the weekday labels stay pinned at the left, so the squares always
  // start right after them)
  const left = Math.max(0, (visibleWidth - gridWidth) / 2) + labelWidth;
  below.style.marginLeft = `${left}px`;
  below.style.width = `${Math.max(0, Math.min(gridWidth, visibleWidth) - labelWidth)}px`;

  renderHeatLegend(shown, metric);
  renderActivityStats(from, to, period === "last" ? "in the last 12 months" : `in ${period}`);
  // Phones: start at the latest weeks (the last column, not the overhang of
  // its month name)
  scroll.scrollLeft = grid.offsetWidth - scroll.clientWidth;
}

// Codeforces rank colours, for the Average rating legend
const HEAT_RANKS = [
  ["gray", "Below 1200"], ["green", "1200–1399"], ["cyan", "1400–1599"], ["blue", "1600–1899"],
  ["violet", "1900–2099"], ["orange", "2100–2399"], ["red", "2400 and above"]
];

function renderHeatLegend(values, metric) {
  if (metric === "rating") {
    document.getElementById("heat-legend").innerHTML = `<span>Avg rating</span>${HEAT_RANKS.map(([rank, range]) =>
      `<span class="heat-cell heat-rank-${rank}" title="${range}"></span>`).join("")}`;
    return;
  }
  const sorted = heatSteps(values);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const titles = ["None"];
  if (sorted.length) {
    const limits = [sorted[0], at(0.25), at(0.5), at(0.75), sorted[sorted.length - 1]];
    for (let level = 1; level <= 4; level++) {
      const low = level === 1 ? limits[0] : limits[level - 1];
      const high = limits[level];
      titles.push(level === 1 || low === high
        ? `Up to ${formatHeatValue(high, metric)}`
        : `Over ${formatHeatValue(low, metric)}, up to ${formatHeatValue(high, metric)}`);
    }
  }
  document.getElementById("heat-legend").innerHTML =
    `<span>Less</span>${[0, 1, 2, 3, 4].map(level =>
      `<span class="heat-cell heat-l${level}" title="${escapeAttribute(titles[level] || "")}"></span>`).join("")}<span>More</span>`;
}

// Hover (or tap / keyboard focus) a day: a card with its totals and the
// problems solved. It fades in with a slight zoom from the day's side, and
// updates in place when moving to another day; the day gets a thin ring.
function initHeatTooltip(grid) {
  const tip = document.getElementById("heat-tip");
  let activeCell = null;
  const setActive = cell => {
    if (activeCell === cell) return;
    activeCell?.classList.remove("is-active");
    activeCell = cell;
    cell?.classList.add("is-active");
  };
  let hideTimer = null;
  // Clicking (or tapping) a day pins its card: it stays open, ignoring hover
  // over other days, so the pointer can reach the problem codes in it.
  let pinned = null;
  const canHover = window.matchMedia("(hover: hover)").matches;
  const hide = () => {
    clearTimeout(hideTimer);
    pinned = null;
    tip.classList.remove("is-pinned");
    tip.classList.remove("is-open");
    tip.setAttribute("aria-hidden", "true");
    setActive(null);
  };
  // A short grace period lets the pointer cross from the day to the card
  // (whose problem codes are links to Progress) without the card closing
  const hideSoon = () => {
    if (pinned) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 180);
  };
  const keepOpen = () => clearTimeout(hideTimer);
  const show = cell => {
    keepOpen();
    const wasOpen = tip.classList.contains("is-open");
    setActive(cell);
    const day = heatDays.get(cell.dataset.day);
    const [y, m, d] = cell.dataset.day.split("-").map(Number);
    const date = new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short", day: "numeric", month: "short", year: "numeric"
    });
    const summary = day
      ? `<div class="heat-tip-summary">${day.problems} problem${day.problems === 1 ? "" : "s"}<span class="heat-tip-dot"> · </span>${formatDuration(day.seconds)}${day.timed > 1
          ? `<span class="heat-tip-dot"> · </span><span class="heat-tip-avg">avg ${formatDuration(Math.round(day.seconds / day.timed))}</span>` : ""}</div>${day.rated
          ? `<div class="heat-tip-rating">Avg rating <span class="${ratingColorClass(Math.round(day.ratingSum / day.rated))}">${Math.round(day.ratingSum / day.rated)}</span></div>` : ""}
        <ul class="heat-tip-list">${day.items.map(({ item, hidden }) =>
          `<li><a class="heat-tip-code" href="${safeHref(item.problemUrl)}" target="_blank" rel="noopener" title="Open on Codeforces">${problemCode(item)}</a><a class="heat-tip-name" href="/progress?search=${encodeURIComponent(`${item.contestId}${item.problemIndex}`)}" data-route="progress" title="Show on Progress">${escapeHtml(item.problemName || "")}</a><span class="heat-tip-time">${hidden ? "--" : formatDuration(item.timeSpentSeconds || 0)}</span></li>`).join("")}</ul>`
      : `<div class="heat-tip-empty">No problems solved</div>`;
    const hint = !day ? ""
      : pinned === cell ? `<div class="heat-tip-hint">Code opens Codeforces · name opens it on Progress</div>`
      : canHover ? `<div class="heat-tip-hint">Click the day to keep this open</div>` : "";
    tip.classList.toggle("is-pinned", pinned === cell);
    tip.innerHTML = `<div class="heat-tip-head"><span class="heat-tip-swatch" style="background:${getComputedStyle(cell).backgroundColor}"></span>${date}</div>${summary}${hint}`;

    // Place it above the day (below when there's no room), kept on screen.
    // offsetWidth/Height ignore the entrance scale, so the size is exact.
    const rect = cell.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const center = rect.left + rect.width / 2;
    let left = Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8));
    const below = rect.top - height - 8 < 8;
    const top = below ? rect.bottom + 8 : rect.top - height - 8;
    tip.classList.toggle("is-below", below);
    tip.style.setProperty("--origin-x", `${Math.max(0, Math.min(width, center - left))}px`);

    // Opening: place it, then animate in. Already open: just move it.
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    if (!wasOpen) {
      void tip.offsetWidth; // start the entrance from the new spot
      tip.classList.add("is-open");
    }
    tip.setAttribute("aria-hidden", "false");
  };
  grid.addEventListener("mouseover", e => { const cell = e.target.closest(".heat-cell"); if (cell && !pinned) show(cell); });
  grid.addEventListener("focusin", e => { const cell = e.target.closest(".heat-cell"); if (cell && !pinned) show(cell); });
  grid.addEventListener("click", e => {
    const cell = e.target.closest(".heat-cell");
    if (!cell) return;
    if (pinned === cell) { hide(); return; } // clicking the pinned day again closes it
    pinned = cell;
    show(cell);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && tip.classList.contains("is-open")) hide(); });
  grid.addEventListener("mouseleave", hideSoon);
  grid.addEventListener("focusout", e => { if (!tip.contains(e.relatedTarget)) hideSoon(); });
  tip.addEventListener("mouseenter", keepOpen);
  tip.addEventListener("mouseleave", hideSoon);
  tip.addEventListener("focusin", keepOpen);
  tip.addEventListener("focusout", e => { if (!tip.contains(e.relatedTarget)) hideSoon(); });
  // Progress links leave the dashboard, so close; Codeforces opens a new tab,
  // so the card stays for opening more
  tip.addEventListener("click", e => { if (e.target.closest("a[data-route]")) hide(); });
  document.getElementById("heat-scroll").addEventListener("scroll", hide, { passive: true });
  window.addEventListener("scroll", hide, { passive: true });
  document.addEventListener("click", e => { if (!e.target.closest(".heat-cell, #heat-tip")) hide(); });
}

// Problems, time, active days and longest streak for the period the grid
// shows (the last 12 months or the chosen year), up to today
function renderActivityStats(from, to, label) {
  const last = Math.min(to, startOfDay(new Date()));
  let problems = 0, seconds = 0, active = 0, best = 0, run = 0;
  for (let d = new Date(from); d <= last; d = addDays(d, 1)) {
    const day = heatDays.get(dayKey(d));
    if (day) {
      problems += day.problems;
      seconds += day.seconds;
      active += 1;
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const stats = [
    [plural(problems, "problem"), `solved ${label}`],
    [formatDuration(seconds), `spent ${label}`],
    [plural(active, "day"), `with at least one problem`],
    [plural(best, "day"), `in a row, longest streak`]
  ];
  document.getElementById("heat-stats").innerHTML = stats.map(([value, text]) =>
    `<div class="heat-stat"><b>${value}</b><span>${text}</span></div>`).join("");
}

function renderDashboard(items) {
  const dateEl = document.getElementById("dash-date");
  if (!dateEl) return;

  renderActivity(items);

  const now = new Date();
  dateEl.textContent = now.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  // Today / week / all-time, by the local calendar day the problem was solved
  const today = now.toDateString();
  const weekAgo = new Date(now);
  weekAgo.setHours(0, 0, 0, 0);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const todayItems = items.filter(item => solvedAtOf(item).toDateString() === today);
  const weekItems = items.filter(item => solvedAtOf(item) >= weekAgo);
  const todaySeconds = todayItems.reduce((sum, item) => sum + (item.timeSpentSeconds || 0), 0);

  document.getElementById("dash-today-count").textContent = todayItems.length;
  document.getElementById("dash-today-time").textContent = formatDuration(todaySeconds);
  document.getElementById("dash-week-count").textContent = weekItems.length;

  const noteEl = document.getElementById("dash-today-note");
  if (todayItems.length) {
    noteEl.textContent = `Reflected today: ${todayItems.map(problemCode).join(", ")}.`;
  } else {
    noteEl.innerHTML = `Nothing reflected yet today. <a href="/load" data-route="load">Load a problem →</a>`;
  }

  // 3 most recently written reflections. created_at holds the solve date (and
  // can be edited on Manage), so creation order comes from the id, which the
  // database assigns in increasing order and never changes on edit.
  const recentEl = document.getElementById("dash-recent");
  const recent = [...items].sort((a, b) => b.id - a.id).slice(0, 3);
  if (!recent.length) {
    recentEl.innerHTML = `<div class="dash-empty">No reflections yet. <a href="/load" data-route="load">Load your first problem →</a></div>`;
  } else {
    recentEl.innerHTML = `
      <table class="dash-table">
        <tbody>
          ${recent.map(item => `
            <tr>
              <td class="dash-col-code"><a href="${safeHref(item.problemUrl)}" target="_blank" rel="noopener" title="Open on Codeforces">${problemCode(item)}</a></td>
              <td>
                <div class="dash-recent-head">
                  <a class="dash-name-link" href="/progress?search=${encodeURIComponent(`${item.contestId}${item.problemIndex}`)}" data-route="progress" title="Show on Progress">${escapeHtml(item.problemName)}</a>
                  <span class="${ratingColorClass(item.rating)}">${item.rating ?? "—"}</span>
                  <span class="dash-muted">· solved ${formatSavedDate(item.createdAt || item.updatedAt)}</span>
                </div>
                <div class="dash-trigger markdown-body"><span class="dash-trigger-label">Future trigger:</span> ${renderMarkdown(item.futureTrigger)}</div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  // Recurring stuck reasons
  const reasonsEl = document.getElementById("dash-weak-reasons");
  const byReason = new Map();
  for (const item of items) {
    for (const key of stuckReasonKeysOf(item)) {
      if (key === "not-stuck") continue;
      if (!byReason.has(key)) byReason.set(key, []);
      byReason.get(key).push(item);
    }
  }
  // Top-4 board: a reason only gets in by beating the 4th entry outright. On a
  // tie the reason that has been on the board longer (its first reflection was
  // written earlier; ids follow creation order) keeps its place.
  const reasons = [...byReason.entries()]
    .map(([key, problems]) => ({
      key,
      label: stuckReasonLabel(key),
      since: Math.min(...problems.map(item => item.id)),
      problems: problems.sort((a, b) => solvedAtOf(b) - solvedAtOf(a))
    }))
    .sort((a, b) => (b.problems.length - a.problems.length) || (a.since - b.since))
    .slice(0, 4);

  reasonsEl.innerHTML = reasons.length
    ? `<table class="dash-table side-list"><tbody>${reasons.map(reason => `
        <tr>
          <td class="dash-count">${reason.problems.length}×</td>
          <td>
            <a href="/progress?reason=${reason.key}" data-route="progress" title="Show these reflections on Progress">${escapeHtml(reason.label)}</a>
            <div class="dash-muted dash-codes">${reason.problems.slice(0, 3).map(problemCode).join(", ")}${reason.problems.length > 3 ? ` +${reason.problems.length - 3} more` : ""}</div>
          </td>
        </tr>`).join("")}</tbody></table>`
    : `<div class="dash-muted side-empty">No recurring reasons detected yet.</div>`;

  // Slowest tags (at least 2 problems)
  const tagsEl = document.getElementById("dash-weak-tags");
  const byTag = new Map();
  for (const item of items) {
    for (const tag of item.tags || []) {
      const entry = byTag.get(tag) || { tag, count: 0, seconds: 0, ids: [] };
      entry.count++;
      entry.seconds += item.timeSpentSeconds || 0;
      entry.ids.push(item.id);
      byTag.set(tag, entry);
    }
  }
  // Same top-4 rule: a tag needs a strictly higher average (to the second) to
  // push one out; on a tie the tag that qualified first (reached its 2nd
  // problem earlier) stays.
  const avgSeconds = entry => Math.round(entry.seconds / entry.count);
  const slowTags = [...byTag.values()]
    .filter(entry => entry.count >= 2)
    .map(entry => ({ ...entry, since: [...entry.ids].sort((x, y) => x - y)[1] }))
    .sort((a, b) => (avgSeconds(b) - avgSeconds(a)) || (a.since - b.since))
    .slice(0, 4);

  tagsEl.innerHTML = slowTags.length
    ? `<table class="dash-table side-list"><tbody>${slowTags.map(entry => `
        <tr>
          <td class="dash-count">${formatDuration(Math.round(entry.seconds / entry.count))}</td>
          <td>${escapeHtml(entry.tag)}<div class="dash-muted dash-codes">${entry.count} problems</div></td>
        </tr>`).join("")}</tbody></table>`
    : `<div class="dash-muted side-empty">Needs at least 2 problems with the same tag.</div>`;
}

function renderJournalEmpty(message) {
  const html = `<div class="journal-empty">${escapeHtml(message)}</div>`;
  for (const id of ["history", "history-progress"]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
}

function buildJournalTable(items, { compact = false } = {}) {
  return `
    <table class="journal-table">
      <thead>
        <tr>
          <th class="col-code">#</th>
          <th class="col-rating" style="text-align: center;">Rating</th>
          <th>Problem</th>
          <th class="col-time" style="text-align: center;">Time</th>
          <th class="col-saved" style="text-align: center;">Solved</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => `
          <tr class="journal-row" data-id="${item.id}" title="Click to view reflection notes">
            <td class="col-code"><a href="${safeHref(item.problemUrl)}" target="_blank" rel="noopener" title="Open on Codeforces">${problemCode(item)}</a></td>
            <td class="col-rating ${ratingColorClass(item.rating)}" style="text-align: center;">${item.rating ?? "—"}</td>
            <td>
              <b>${escapeHtml(item.problemName)}</b>
            </td>
            <td class="col-time" style="text-align: center;">${isProblemTimeHidden(item.contestId, item.problemIndex) ? "--" : formatDuration(item.timeSpentSeconds)}</td>
            <td class="col-saved" style="text-align: center;">${formatSavedDate(item.createdAt || item.updatedAt)}</td>
          </tr>
          <tr class="journal-detail-row hidden" id="journal-detail-${item.id}">
            <td colspan="5">
              <div class="journal-detail-wrapper">
                <div class="journal-detail-card cf-spoilers-wrap">
                  <!-- 1. Key observation -->
                  <div class="spoiler">
                    <div class="spoiler-title">
                      <svg class="spoiler-arrow" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9"/></svg>
                      <span class="spoiler-label">Key observation</span>
                    </div>
                    <div class="spoiler-content markdown-body">${renderMarkdown(item.keyObservation || "—")}</div>
                  </div>

                  <!-- 2. What made me stuck -->
                  <div class="spoiler">
                    <div class="spoiler-title">
                      <svg class="spoiler-arrow" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9"/></svg>
                      <span class="spoiler-label">What made me stuck</span>
                    </div>
                    <div class="spoiler-content markdown-body">${stuckReasonChip(item.stuckReason)}${renderMarkdown(item.whatMadeMeStuck || "—")}</div>
                  </div>

                  <!-- 3. Pattern -->
                  <div class="spoiler">
                    <div class="spoiler-title">
                      <svg class="spoiler-arrow" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9"/></svg>
                      <span class="spoiler-label">Pattern</span>
                    </div>
                    <div class="spoiler-content markdown-body">${renderMarkdown(item.pattern || "—")}</div>
                  </div>

                  <!-- 4. Future recognition -->
                  <div class="spoiler">
                    <div class="spoiler-title">
                      <svg class="spoiler-arrow" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9"/></svg>
                      <span class="spoiler-label">Future recognition</span>
                    </div>
                    <div class="spoiler-content markdown-body">${renderMarkdown(item.futureTrigger || "—")}</div>
                  </div>

                  <!-- 5. Simplest implementation -->
                  <div class="spoiler">
                    <div class="spoiler-title">
                      <svg class="spoiler-arrow" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9"/></svg>
                      <span class="spoiler-label">Simplest implementation</span>
                    </div>
                    <div class="spoiler-content markdown-body spoiler-code-content">${renderCodeOnly(item.simplestImplementation)}</div>
                  </div>

                  <!-- 6. Problem tags -->
                  <div class="spoiler">
                    <div class="spoiler-title">
                      <svg class="spoiler-arrow" viewBox="0 0 10 10"><polygon points="2,1 8,5 2,9"/></svg>
                      <span class="spoiler-label">Problem tags</span>
                    </div>
                    <div class="spoiler-content spoiler-tags-content">${(item.tags && item.tags.length) ? `<div class="tags-list">${item.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : `<span class="readonly">—</span>`}</div>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function expandJournalDetail(detailRow, row) {
  const wrapper = detailRow.querySelector(".journal-detail-wrapper");
  if (!wrapper) {
    detailRow.classList.remove("hidden");
    row.classList.add("expanded");
    return;
  }

  let startHeight = null;
  if (wrapper._currentAnim) {
    startHeight = wrapper.getBoundingClientRect().height;
    wrapper._currentAnim.cancel();
  }

  detailRow.classList.remove("hidden");
  row.classList.add("expanded");

  const naturalHeight = wrapper.scrollHeight;
  if (!naturalHeight) return;

  const fromHeight = startHeight !== null ? `${startHeight}px` : "0px";
  const fromOpacity = startHeight !== null ? Math.min(1, startHeight / Math.max(1, naturalHeight)) : 0;
  const fromTranslate = startHeight !== null ? 0 : -10;

  wrapper._currentAnim = wrapper.animate([
    {
      height: fromHeight,
      paddingTop: startHeight !== null ? "8px" : "0px",
      paddingBottom: startHeight !== null ? "8px" : "0px",
      opacity: fromOpacity,
      transform: `translateY(${fromTranslate}px)`,
      overflow: "hidden"
    },
    {
      height: `${naturalHeight}px`,
      paddingTop: "8px",
      paddingBottom: "8px",
      opacity: 1,
      transform: "translateY(0)",
      overflow: "hidden"
    }
  ], {
    duration: 600,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)"
  });

  wrapper._currentAnim.onfinish = () => {
    wrapper._currentAnim = null;
    wrapper.style.height = "";
    wrapper.style.overflow = "";
    wrapper.style.paddingTop = "";
    wrapper.style.paddingBottom = "";
  };
}

function collapseJournalDetail(detailRow, row) {
  const wrapper = detailRow.querySelector(".journal-detail-wrapper");
  if (!wrapper) {
    detailRow.classList.add("hidden");
    row.classList.remove("expanded");
    return;
  }

  let startHeight = null;
  if (wrapper._currentAnim) {
    startHeight = wrapper.getBoundingClientRect().height;
    wrapper._currentAnim.cancel();
  }

  row.classList.remove("expanded");
  const fullHeight = wrapper.offsetHeight || wrapper.scrollHeight;
  if (!fullHeight) {
    detailRow.classList.add("hidden");
    return;
  }

  const fromHeight = startHeight !== null ? `${startHeight}px` : `${fullHeight}px`;
  const fromOpacity = startHeight !== null ? Math.min(1, startHeight / Math.max(1, fullHeight)) : 1;

  wrapper._currentAnim = wrapper.animate([
    {
      height: fromHeight,
      paddingTop: "8px",
      paddingBottom: "8px",
      opacity: fromOpacity,
      transform: "translateY(0)",
      overflow: "hidden"
    },
    {
      height: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
      opacity: 0,
      transform: "translateY(-8px)",
      overflow: "hidden"
    }
  ], {
    duration: 380,
    easing: "cubic-bezier(0.25, 0.8, 0.25, 1)"
  });

  wrapper._currentAnim.onfinish = () => {
    detailRow.classList.add("hidden");
    wrapper._currentAnim = null;
    wrapper.style.height = "";
    wrapper.style.overflow = "";
    wrapper.style.paddingTop = "";
    wrapper.style.paddingBottom = "";
  };
}

function attachJournalRowHandlers(root) {
  root.querySelectorAll(".journal-row").forEach(row => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const detailRow = root.querySelector(`#journal-detail-${row.dataset.id}`);
      if (!detailRow) return;
      const isHidden = detailRow.classList.contains("hidden");

      // Close other open rows in this table for clean animated accordion behavior
      root.querySelectorAll(".journal-detail-row").forEach(dr => {
        if (dr !== detailRow && !dr.classList.contains("hidden")) {
          const id = dr.id.replace("journal-detail-", "");
          const otherRow = root.querySelector(`.journal-row[data-id="${id}"]`);
          collapseJournalDetail(dr, otherRow || row);
        }
      });

      if (isHidden) {
        expandJournalDetail(detailRow, row);
      } else {
        collapseJournalDetail(detailRow, row);
      }
    });
  });

}

function renderJournalTables(items) {
  journalCache = items || [];
  populateProgressTagFilter(journalCache);
  applyJournalFilters();
}

function populateProgressTagFilter(items) {
  const tagSelect = document.getElementById("progress-tag-filter");
  if (!tagSelect) return;

  const currentVal = journalFilterState.tag;
  const tagCounts = new Map();

  for (const item of items) {
    if (Array.isArray(item.tags)) {
      for (const t of item.tags) {
        if (!t) continue;
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
  }

  const sortedTags = Array.from(tagCounts.keys()).sort((a, b) => a.localeCompare(b));

  tagSelect.innerHTML = `<option value="all">All tags (${items.length})</option>` +
    sortedTags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)} (${tagCounts.get(tag)})</option>`).join("");

  if (currentVal && (currentVal === "all" || tagCounts.has(currentVal))) {
    tagSelect.value = currentVal;
  } else {
    tagSelect.value = "all";
    journalFilterState.tag = "all";
  }
}

// "<Type> filter is used, click here to reset" above the Progress table,
// naming every filter in effect (sort order isn't a filter)
function renderProgressFilterNotice(activeReason) {
  const notice = document.getElementById("progress-filter-notice");
  if (!notice) return;
  const f = journalFilterState;
  const types = [];
  if ((f.search || "").trim()) types.push("Search");
  if (f.minRating !== "" || f.maxRating !== "" || (f.ratingCategory && f.ratingCategory !== "all")) types.push("Rating");
  if (f.tag && f.tag !== "all") types.push("Tag");
  if (activeReason) types.push("Stuck reason");

  notice.classList.toggle("hidden", !types.length);
  if (!types.length) return;
  const names = types.map(t => `<b>${t}</b>`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  notice.innerHTML = `${list} filter${types.length === 1 ? " is" : "s are"} used, <a href="/progress" id="progress-filter-reset">click here to reset</a>.`;
}

function applyJournalFilters() {
  if (!journalCache) return;

  let filtered = [...journalCache];

  // 1. Search Query
  const q = (journalFilterState.search || "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(item => {
      const code = `${item.contestId}${item.problemIndex}`.toLowerCase();
      const codeSpaced = `${item.contestId} ${item.problemIndex}`.toLowerCase();
      const codeSlash = `${item.contestId}/${item.problemIndex}`.toLowerCase();
      const name = (item.problemName || "").toLowerCase();
      const obs = (item.keyObservation || "").toLowerCase();
      const pattern = (item.pattern || "").toLowerCase();
      const stuck = (item.whatMadeMeStuck || "").toLowerCase();
      const trigger = (item.futureTrigger || "").toLowerCase();
      const tags = Array.isArray(item.tags) ? item.tags.join(" ").toLowerCase() : "";

      return (
        code.includes(q) ||
        codeSpaced.includes(q) ||
        codeSlash.includes(q) ||
        name.includes(q) ||
        obs.includes(q) ||
        pattern.includes(q) ||
        stuck.includes(q) ||
        trigger.includes(q) ||
        tags.includes(q)
      );
    });
  }

  // 2. Rating Filter
  const minR = journalFilterState.minRating !== "" ? Number(journalFilterState.minRating) : null;
  const maxR = journalFilterState.maxRating !== "" ? Number(journalFilterState.maxRating) : null;

  if (minR !== null || maxR !== null) {
    filtered = filtered.filter(item => {
      if (item.rating == null) return false;
      if (minR !== null && !isNaN(minR) && item.rating < minR) return false;
      if (maxR !== null && !isNaN(maxR) && item.rating > maxR) return false;
      return true;
    });
  } else if (journalFilterState.ratingCategory && journalFilterState.ratingCategory !== "all") {
    const cat = journalFilterState.ratingCategory;
    filtered = filtered.filter(item => {
      const r = item.rating;
      if (cat === "unrated") return r == null;
      if (r == null) return false;
      if (cat === "0-1199") return r < 1200;
      if (cat === "1200-1399") return r >= 1200 && r <= 1399;
      if (cat === "1400-1599") return r >= 1400 && r <= 1599;
      if (cat === "1600-1899") return r >= 1600 && r <= 1899;
      if (cat === "1900-2099") return r >= 1900 && r <= 2099;
      if (cat === "2100+") return r >= 2100;
      return true;
    });
  }

  // 3. Tag Filter
  if (journalFilterState.tag && journalFilterState.tag !== "all") {
    filtered = filtered.filter(item => Array.isArray(item.tags) && item.tags.includes(journalFilterState.tag));
  }

  // 3b. Stuck-reason filter (set from the dashboard's "Stuck reasons" box)
  const activeReasonKey = journalFilterState.reason;
  const activeReason = activeReasonKey ? { key: activeReasonKey, label: stuckReasonLabel(activeReasonKey) } : null;
  if (activeReason) {
    filtered = filtered.filter(item => stuckReasonKeysOf(item).includes(activeReason.key));
  }
  const reasonBar = document.getElementById("progress-reason-filter");
  if (reasonBar) {
    reasonBar.classList.toggle("hidden", !activeReason);
    if (activeReason) {
      reasonBar.innerHTML = `Stuck reason: <b>${escapeHtml(activeReason.label)}</b> <a href="#" id="progress-clear-reason">Clear</a>`;
      document.getElementById("progress-clear-reason").addEventListener("click", (e) => {
        e.preventDefault();
        journalFilterState.reason = "";
        history.replaceState({ path: "/progress" }, "", "/progress");
        applyJournalFilters();
      });
    }
  }

  renderProgressFilterNotice(activeReason);

  // 4. Sort Order
  const solvedTime = item => new Date(item.createdAt || item.updatedAt || 0).getTime();
  filtered.sort((a, b) => {
    switch (journalFilterState.sortBy) {
      case "recent-solves":
        return (solvedTime(b) - solvedTime(a)) || ((b.id || 0) - (a.id || 0));
      case "date-asc":
        return (solvedTime(a) - solvedTime(b)) || ((a.id || 0) - (b.id || 0));
      case "rating-desc":
        return (b.rating ?? -1) - (a.rating ?? -1);
      case "rating-asc":
        return (a.rating ?? 9999) - (b.rating ?? 9999);
      case "time-desc":
        return (b.timeSpentSeconds || 0) - (a.timeSpentSeconds || 0);
      case "time-asc":
        return (a.timeSpentSeconds || 0) - (b.timeSpentSeconds || 0);
      case "date-desc":
      default:
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    }
  });

  // 5. Pagination: back to page 1 when filters/sort change, clamp otherwise
  const filterKey = JSON.stringify({ ...journalFilterState, pageSize: journalPageSize });
  if (filterKey !== lastJournalFilterKey) {
    journalPage = 1;
    lastJournalFilterKey = filterKey;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / journalPageSize));
  journalPage = Math.min(Math.max(1, journalPage), totalPages);
  const pageStart = (journalPage - 1) * journalPageSize;
  const pageItems = filtered.slice(pageStart, pageStart + journalPageSize);
  const range = totalPages > 1 ? ` (${pageStart + 1}–${pageStart + pageItems.length} on this page)` : "";

  // 6. Update Status Counters
  const countEl = document.getElementById("progress-filter-count");
  if (countEl) {
    if (journalCache.length === 0) {
      countEl.textContent = "No reflections in journal yet.";
    } else if (filtered.length === journalCache.length) {
      countEl.textContent = `Showing all ${journalCache.length} reflection${journalCache.length === 1 ? "" : "s"}${range}`;
    } else {
      countEl.textContent = `Showing ${filtered.length} of ${journalCache.length} reflection${journalCache.length === 1 ? "" : "s"}${range}`;
    }
  }

  const tableCaption = document.getElementById("progress-table-caption");
  if (tableCaption) {
    tableCaption.textContent = `Completed Reflections (${filtered.length})`;
  }

  // 7. Render Rows
  const progressRoot = document.getElementById("history-progress");
  if (progressRoot) {
    if (!filtered.length) {
      if (journalCache.length === 0) {
        progressRoot.innerHTML = `<div class="journal-empty">No completed reflections yet. <a href="/load" data-route="load">Load and reflect on a problem →</a></div>`;
      } else {
        progressRoot.innerHTML = `<div class="journal-empty">No reflections match the current filter. <a href="#" id="clear-progress-filters-btn">Reset filters</a></div>`;
        const resetBtn = document.getElementById("clear-progress-filters-btn");
        if (resetBtn) {
          resetBtn.addEventListener("click", (e) => {
            e.preventDefault();
            resetProgressFilters();
          });
        }
      }
    } else {
      progressRoot.innerHTML = buildJournalTable(pageItems) + buildPagination(journalPage, totalPages);
      attachJournalRowHandlers(progressRoot);
      progressRoot.querySelectorAll(".cf-pagination a.cf-page").forEach(link => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          journalPage = Number(link.dataset.page);
          applyJournalFilters();
          document.getElementById("progress-table-caption")?.scrollIntoView({ block: "nearest" });
        });
      });
    }
  }

  const legacyRoot = document.getElementById("history");
  if (legacyRoot) {
    legacyRoot.innerHTML = progressRoot ? progressRoot.innerHTML : "";
  }
}

function resetProgressFilters({ keepUrl = false, keepSort = false } = {}) {
  const sortBy = keepSort ? journalFilterState.sortBy : "recent-solves";
  journalFilterState = {
    search: "",
    ratingCategory: "all",
    minRating: "",
    maxRating: "",
    tag: "all",
    reason: "",
    sortBy
  };
  if (!keepUrl && location.pathname === "/progress" && location.search) {
    history.replaceState({ path: "/progress" }, "", "/progress");
  }

  const searchInput = document.getElementById("progress-search-input");
  if (searchInput) searchInput.value = "";

  const minInput = document.getElementById("progress-rating-min");
  if (minInput) minInput.value = "";

  const maxInput = document.getElementById("progress-rating-max");
  if (maxInput) maxInput.value = "";

  const tagSelect = document.getElementById("progress-tag-filter");
  if (tagSelect) tagSelect.value = "all";

  const sortSelect = document.getElementById("progress-sort-by");
  if (sortSelect) sortSelect.value = sortBy;

  const pillButtons = document.querySelectorAll("#progress-rating-pills .cf-filter-pill");
  pillButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.ratingFilter === "all");
  });

  applyJournalFilters();
}

function setupProgressFilterListeners() {
  if (journalFiltersInitialized) return;
  journalFiltersInitialized = true;

  // "click here to reset" in the filter notice: clear every filter, keep sort
  document.getElementById("progress-filter-notice")?.addEventListener("click", (e) => {
    if (!e.target.closest("#progress-filter-reset")) return;
    e.preventDefault();
    resetProgressFilters({ keepSort: true });
  });

  const form = document.getElementById("progress-filter-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      applyJournalFilters();
    });
  }

  // Search input
  const searchInput = document.getElementById("progress-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      journalFilterState.search = searchInput.value;
      applyJournalFilters();
    });
  }

  // Category Pills
  const pillsContainer = document.getElementById("progress-rating-pills");
  if (pillsContainer) {
    pillsContainer.addEventListener("click", (e) => {
      const pill = e.target.closest(".cf-filter-pill");
      if (!pill) return;

      pillsContainer.querySelectorAll(".cf-filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      journalFilterState.ratingCategory = pill.dataset.ratingFilter || "all";

      // Clear min/max inputs when selecting a category preset
      journalFilterState.minRating = "";
      journalFilterState.maxRating = "";
      const minInput = document.getElementById("progress-rating-min");
      const maxInput = document.getElementById("progress-rating-max");
      if (minInput) minInput.value = "";
      if (maxInput) maxInput.value = "";

      applyJournalFilters();
    });
  }

  // Min / Max Difficulty Inputs
  const minInput = document.getElementById("progress-rating-min");
  const maxInput = document.getElementById("progress-rating-max");

  const onMinMaxChange = () => {
    journalFilterState.minRating = minInput ? minInput.value.trim() : "";
    journalFilterState.maxRating = maxInput ? maxInput.value.trim() : "";

    if (journalFilterState.minRating !== "" || journalFilterState.maxRating !== "") {
      // Clear category pill active state
      if (pillsContainer) {
        pillsContainer.querySelectorAll(".cf-filter-pill").forEach(p => {
          p.classList.toggle("active", p.dataset.ratingFilter === "all");
        });
      }
      journalFilterState.ratingCategory = "all";
    }

    applyJournalFilters();
  };

  if (minInput) minInput.addEventListener("input", onMinMaxChange);
  if (maxInput) maxInput.addEventListener("input", onMinMaxChange);

  // Tag filter
  const tagSelect = document.getElementById("progress-tag-filter");
  if (tagSelect) {
    tagSelect.addEventListener("change", () => {
      journalFilterState.tag = tagSelect.value;
      applyJournalFilters();
    });
  }

  // Sort order
  const sortSelect = document.getElementById("progress-sort-by");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      journalFilterState.sortBy = sortSelect.value;
      applyJournalFilters();
    });
  }

  // Page size: a display preference, remembered in this browser and kept on Reset
  const pageSizeSelect = document.getElementById("progress-page-size");
  if (pageSizeSelect) {
    pageSizeSelect.value = String(journalPageSize);
    pageSizeSelect.addEventListener("change", () => {
      const size = Number(pageSizeSelect.value);
      if (!JOURNAL_PAGE_SIZES.includes(size)) return;
      journalPageSize = size;
      try {
        localStorage.setItem(JOURNAL_PAGE_SIZE_KEY, String(size));
      } catch (_) {}
      applyJournalFilters();
    });
  }

  // Reset button
  const resetBtn = document.getElementById("progress-btn-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetProgressFilters();
    });
  }

  // Apply button
  const applyBtn = document.getElementById("progress-btn-apply");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      applyJournalFilters();
    });
  }
}

function parseCodeforcesUrl(raw) {
  const trimmed = String(raw || "").trim();

  // Shorthand support: e.g. "1904A" or "1904/A"
  const shortMatch = trimmed.match(/^(\d+)\s*\/?\s*([A-Za-z]\d*)$/);
  if (shortMatch) {
    return {
      contestId: Number(shortMatch[1]),
      index: shortMatch[2].toUpperCase()
    };
  }

  try {
    const url = new URL(trimmed);

    if (!/codeforces\.com$/i.test(url.hostname) && !/\.codeforces\.com$/i.test(url.hostname)) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
      if (
        parts[i] === "problemset" &&
        parts[i + 1] === "problem" &&
        parts[i + 2] &&
        parts[i + 3]
      ) {
        return {
          contestId: Number(parts[i + 2]),
          index: parts[i + 3].toUpperCase()
        };
      }

      if (
        parts[i] === "contest" &&
        parts[i + 1] &&
        parts[i + 2] === "problem" &&
        parts[i + 3]
      ) {
        return {
          contestId: Number(parts[i + 1]),
          index: parts[i + 3].toUpperCase()
        };
      }
    }
  } catch (_) {}

  return null;
}

function showMessage(text, error = false) {
  const el = document.getElementById("message");
  if (!el) return;
  el.textContent = text;
  el.className = error ? "message error" : "message";
  el.classList.remove("hidden");
}

function clearMessage() {
  const el = document.getElementById("message");
  if (el) el.classList.add("hidden");
}

function setSaveStatus(text, error = false) {
  for (const id of ["save-status", "view-save-status"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = text;
    el.className = error ? "save-status error" : "save-status";
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatSavedDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatSolvedAtDate(isoDate) {
  if (!isoDate) return `<span class="readonly" style="color: #999;">—</span>`;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return `<span class="readonly" style="color: #999;">—</span>`;

  const formatted = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const fullTimestamp = d.toLocaleString();

  return `<span title="${escapeAttribute(fullTimestamp)}">${formatted}</span>`;
}

function ratingColorClass(rating) {
  if (rating == null || isNaN(rating)) return "rating-gray";
  const r = Number(rating);
  if (r < 1200) return "rating-gray";
  if (r < 1400) return "rating-green";
  if (r < 1600) return "rating-cyan";
  if (r < 1900) return "rating-blue";
  if (r < 2100) return "rating-violet";
  if (r < 2400) return "rating-orange";
  return "rating-red";
}

function updateSidebar(items) {
  const count = String(items.length);
  document.getElementById("stat-problems").textContent = count;
  const pageCount = document.getElementById("stat-problems-page");
  if (pageCount) pageCount.textContent = count;

  const totalSeconds = items.reduce((sum, item) => sum + (item.timeSpentSeconds || 0), 0);
  const totalLabel = formatDuration(totalSeconds);

  document.getElementById("stat-total-time").textContent = totalLabel;
  const pageTotal = document.getElementById("stat-total-time-page");
  if (pageTotal) pageTotal.textContent = totalLabel;

  const avgSeconds = items.length ? Math.round(totalSeconds / items.length) : null;
  const avgTimeLabel = avgSeconds == null ? "—" : formatDuration(avgSeconds);

  document.getElementById("stat-avg-time").textContent = avgTimeLabel;
  const pageAvgTime = document.getElementById("stat-avg-time-page");
  if (pageAvgTime) pageAvgTime.textContent = avgTimeLabel;

  const rated = items.filter(item => item.rating != null);
  const avgRating = rated.length
    ? Math.round(rated.reduce((sum, item) => sum + item.rating, 0) / rated.length)
    : null;

  for (const id of ["stat-avg-rating", "stat-avg-rating-page"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = avgRating ?? "—";
    el.className = ratingColorClass(avgRating);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

// href for a stored URL: only http(s) links are clickable, so a crafted
// "javascript:" URL can never run
function safeHref(url) {
  return /^https?:\/\//i.test(String(url ?? "")) ? escapeAttribute(url) : "#";
}

// ==========================================================================
// Markdown Rendering & Editor Controls
// ==========================================================================
function renderMarkdown(text) {
  if (!text || typeof text !== "string") return '<span class="readonly">—</span>';
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "—") return '<span class="readonly">—</span>';

  let src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 1. Extract fenced code blocks
  const codeBlocks = [];
  src = src.replace(/(?:^|\n)```([a-zA-Z0-9_+-]*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
    const placeholder = `\n\n@@CODEBLOCK_${codeBlocks.length}@@\n\n`;
    codeBlocks.push({ lang: lang.trim(), code });
    return placeholder;
  });

  // 2. Extract inline code
  const inlineCodes = [];
  src = src.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `@@INLINECODE_${inlineCodes.length}@@`;
    inlineCodes.push(code);
    return placeholder;
  });

  // 3. Extract display math $$...$$ and inline math $...$
  const mathBlocks = [];
  src = src.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    const placeholder = `\n\n@@MATHBLOCK_${mathBlocks.length}@@\n\n`;
    mathBlocks.push({ block: true, math: math.trim() });
    return placeholder;
  });
  src = src.replace(/\$([^\$\n]+)\$/g, (match, math) => {
    const placeholder = `@@MATHBLOCK_${mathBlocks.length}@@`;
    mathBlocks.push({ block: false, math: math.trim() });
    return placeholder;
  });

  // 4. Escape remaining HTML
  src = escapeHtml(src);

  // 5. Headings (# to ######)
  src = src.replace(/^######[ \t]+(.*)$/gm, '\n<h6 class="md-heading">$1</h6>\n');
  src = src.replace(/^#####[ \t]+(.*)$/gm, '\n<h5 class="md-heading">$1</h5>\n');
  src = src.replace(/^####[ \t]+(.*)$/gm, '\n<h4 class="md-heading">$1</h4>\n');
  src = src.replace(/^###[ \t]+(.*)$/gm, '\n<h3 class="md-heading">$1</h3>\n');
  src = src.replace(/^##[ \t]+(.*)$/gm, '\n<h2 class="md-heading">$1</h2>\n');
  src = src.replace(/^#[ \t]+(.*)$/gm, '\n<h1 class="md-heading">$1</h1>\n');

  // 6. Horizontal Rules (---, ***, ___)
  src = src.replace(/^(?:[-*_]\s*){3,}$/gm, '\n<hr class="md-hr">\n');

  // 7. Blockquotes (> ...)
  src = src.replace(/^(?:&gt;|>)[ \t]?(.*)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');
  src = src.replace(/<\/blockquote>\n<blockquote class="md-blockquote">/g, '<br>');

  // 8. Tables
  src = src.replace(/((?:^|\n)[ \t]*\|.+[ \t]*\|\n[ \t]*\|[-: \t|]+\|[ \t]*\n(?:[ \t]*\|.+[ \t]*\|(?:\n|$))+)/g, (tableMatch) => {
    const rows = tableMatch.trim().split(/\n/).map(r => r.trim()).filter(Boolean);
    if (rows.length < 2) return tableMatch;
    const parseRow = (row) => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headerCols = parseRow(rows[0]);
    let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
    for (const h of headerCols) {
      html += `<th>${h}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = 2; r < rows.length; r++) {
      const cols = parseRow(rows[r]);
      html += '<tr>';
      for (let c = 0; c < headerCols.length; c++) {
        html += `<td>${cols[c] !== undefined ? cols[c] : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return '\n\n' + html + '\n\n';
  });

  // 9. Lists
  src = src.replace(/^[ \t]*[-*+][ \t]+(.*)$/gm, '<li class="md-li-ul">$1</li>');
  src = src.replace(/^[ \t]*(\d+)\.[ \t]+(.*)$/gm, '<li class="md-li-ol">$2</li>');

  src = src.replace(/(<li class="md-li-ul">[\s\S]*?<\/li>)(?!\s*<li class="md-li-ul">)/g, (match) => {
    return `\n<ul class="md-ul">${match}</ul>\n`;
  });
  src = src.replace(/(<li class="md-li-ol">[\s\S]*?<\/li>)(?!\s*<li class="md-li-ol">)/g, (match) => {
    return `\n<ol class="md-ol">${match}</ol>\n`;
  });
  src = src.replace(/<\/ul>\s*<ul class="md-ul">/g, '');
  src = src.replace(/<\/ol>\s*<ol class="md-ol">/g, '');

  // 10. Links: [label](url)
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, (match, label, url) => {
    return `<a href="${safeHref(url)}" target="_blank" rel="noopener" class="md-link">${label}</a>`;
  });

  // 11. Inline styles: Bold, Italic, Strikethrough, Superscripts, Subscripts
  // Safe HTML sup and sub
  src = src.replace(/&lt;sup&gt;([\s\S]*?)&lt;\/sup&gt;/gi, '<sup>$1</sup>');
  src = src.replace(/&lt;sub&gt;([\s\S]*?)&lt;\/sub&gt;/gi, '<sub>$1</sub>');

  // Superscripts & Exponents: a^{b+1}, a^b^, or a^b / 2^60
  src = src.replace(/(\w+)\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
  src = src.replace(/\^([a-zA-Z0-9_+-]+)\^/g, '<sup>$1</sup>');
  src = src.replace(/(\w+)\^([a-zA-Z0-9_+-]+)/g, '$1<sup>$2</sup>');
  src = src.replace(/~([a-zA-Z0-9_+-]+)~/g, '<sub>$1</sub>');

  src = src.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  src = src.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  src = src.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  src = src.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  src = src.replace(/(^|[^a-zA-Z0-9_])_([^_]+)_(?![a-zA-Z0-9_])/g, '$1<em>$2</em>');

  // 12. Paragraphs and Line Breaks
  const chunks = src.split(/\n\s*\n/);
  src = chunks.map(chunk => {
    const trimmedP = chunk.trim();
    if (!trimmedP) return '';
    if (/^<(h[1-6]|hr|blockquote|div|ul|ol|table|pre)/i.test(trimmedP) || /^@@(CODEBLOCK|MATHBLOCK)/.test(trimmedP)) {
      return trimmedP;
    }
    return `<p class="md-p">${trimmedP.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');

  // 13. Restore math blocks
  mathBlocks.forEach((item, idx) => {
    const tag = renderMath(item.math, item.block);
    src = src.split(`@@MATHBLOCK_${idx}@@`).join(tag);
  });

  // 14. Restore inline code
  inlineCodes.forEach((code, idx) => {
    const escapedCode = escapeHtml(code);
    src = src.split(`@@INLINECODE_${idx}@@`).join(`<code class="md-inline-code">${escapedCode}</code>`);
  });

  // 15. Restore code blocks
  codeBlocks.forEach((item, idx) => {
    const langAttr = item.lang ? ` class="language-${escapeAttribute(item.lang)}"` : '';
    const langBadge = item.lang ? `<div class="md-code-lang">${escapeHtml(item.lang)}</div>` : '';
    const escapedCode = escapeHtml(item.code.replace(/^\n+|\n+$/g, ''));
    const preHtml = `<div class="md-code-wrapper">${langBadge}<pre class="md-code-block"><code${langAttr}>${escapedCode}</code></pre></div>`;
    src = src.split(`@@CODEBLOCK_${idx}@@`).join(preHtml);
  });

  return src;
}

// Typesets LaTeX with KaTeX; falls back to the raw source if KaTeX is unavailable.
// Invalid LaTeX is shown in red instead of throwing (throwOnError: false).
function renderMath(math, block) {
  if (window.katex) {
    try {
      const html = window.katex.renderToString(math, {
        displayMode: block,
        throwOnError: false,
        strict: "ignore"
      });
      return block
        ? `<div class="md-math-block is-typeset">${html}</div>`
        : `<span class="md-math is-typeset">${html}</span>`;
    } catch (_) {}
  }

  const escapedMath = escapeHtml(math);
  return block
    ? `<div class="md-math-block"><code>${escapedMath}</code></div>`
    : `<span class="md-math"><code>${escapedMath}</code></span>`;
}

function applyMarkdownToolbarAction(textarea, action) {
  textarea.focus();
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const sel = text.substring(start, end);

  let replacement = "";

  switch (action) {
    case "bold":
      replacement = sel ? `**${sel}**` : `**bold text**`;
      break;
    case "italic":
      replacement = sel ? `*${sel}*` : `*italic text*`;
      break;
    case "code":
      replacement = sel ? `\`${sel}\`` : `\`code\``;
      break;
    case "codeblock":
      replacement = sel ? `\`\`\`cpp\n${sel}\n\`\`\`` : `\`\`\`cpp\n// Your implementation code\n\`\`\``;
      break;
    case "math":
      replacement = sel ? `$${sel}$` : `$O(N)$`;
      break;
    case "list":
      if (sel) {
        replacement = sel.split("\n").map(l => l.startsWith("- ") ? l : `- ${l}`).join("\n");
      } else {
        replacement = `- List item`;
      }
      break;
    case "quote":
      if (sel) {
        replacement = sel.split("\n").map(l => l.startsWith("> ") ? l : `> ${l}`).join("\n");
      } else {
        replacement = `> Key observation quote`;
      }
      break;
    default:
      return;
  }

  textarea.setRangeText(replacement, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));

  if (!sel) {
    if (action === "bold") textarea.setSelectionRange(start + 2, start + 11);
    else if (action === "italic") textarea.setSelectionRange(start + 1, start + 12);
    else if (action === "code") textarea.setSelectionRange(start + 1, start + 5);
    else if (action === "math") textarea.setSelectionRange(start + 1, start + 5);
  }
}

// Language hint for Google Code Prettify (the highlighter Codeforces uses).
const CODE_LANG_ALIASES = {
  "c++": "cpp", cc: "cpp", cxx: "cpp", c: "cpp",
  python: "py", python3: "py", py3: "py", pypy: "py",
  javascript: "js", node: "js", java: "java", kotlin: "java"
};

function guessCodeLang(code) {
  if (/^\s*#include\b|\bint\s+main\s*\(|\bstd::|\busing\s+namespace\b/m.test(code)) return "cpp";
  if (/\bpublic\s+static\s+void\s+main\b|\bSystem\.out\./.test(code)) return "java";
  if (/^\s*(def |import \w|from \S+ import |elif\b|print\()/m.test(code)) return "py";
  return "";
}

// "Simplest implementation" answer, shown like a Codeforces source listing
// (Prettify syntax colours, no line numbers).
function renderCodeOnly(text) {
  if (!text || typeof text !== "string") return '<span class="readonly" style="display: block; padding: 10px 14px;">—</span>';
  let trimmed = text.trim();
  if (trimmed === "" || trimmed === "—") return '<span class="readonly" style="display: block; padding: 10px 14px;">—</span>';

  let lang = "";
  const fencedMatch = trimmed.match(/^```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)\n?```$/);
  if (fencedMatch) {
    lang = fencedMatch[1].trim().toLowerCase();
    trimmed = fencedMatch[2];
  }
  lang = CODE_LANG_ALIASES[lang] || lang || guessCodeLang(trimmed);

  const escapedCode = escapeHtml(trimmed);
  let body = escapedCode;
  let classes = "prettyprint cf-source";
  if (window.PR && typeof window.PR.prettyPrintOne === "function") {
    try {
      body = window.PR.prettyPrintOne(escapedCode, lang || undefined, false);
    } catch (_) {
      body = escapedCode;
    }
  }

  return `<div class="md-code-wrapper"><pre class="${classes}">${body}</pre></div>`;
}


let markdownEditorsInitialized = false;

function setupMarkdownEditors() {
  if (markdownEditorsInitialized) return;
  markdownEditorsInitialized = true;

  document.addEventListener("click", (e) => {
    // 1. Single Editor Write/Preview Tab (.md-tab)
    const tab = e.target.closest(".md-tab");
    if (tab) {
      const box = tab.closest(".md-editor-box");
      if (!box) return;
      const targetId = box.dataset.target;
      const textarea = document.getElementById(targetId);
      const previewEl = document.getElementById(`${targetId}-preview`);
      if (!textarea || !previewEl) return;

      const mode = tab.dataset.tab;
      box.querySelectorAll(".md-tab").forEach(t => t.classList.toggle("active", t === tab));

      if (mode === "preview") {
        const val = textarea.value.trim();
        const isCodeField = (targetId === "q4" || targetId === "edit-q4");
        previewEl.innerHTML = val
          ? (isCodeField ? renderCodeOnly(val) : renderMarkdown(val))
          : '<div class="md-empty-preview">Nothing to preview yet. Switch to "Write" to add reflection notes.</div>';
        textarea.classList.add("hidden");
        textarea.style.display = "none";
        previewEl.classList.remove("hidden");
        previewEl.style.display = "block";
      }
 else {
        textarea.classList.remove("hidden");
        textarea.style.display = "block";
        previewEl.classList.add("hidden");
        previewEl.style.display = "none";
        textarea.focus();
      }
      return;
    }

    // 2. Toolbar formatting buttons (.md-btn)
    const btn = e.target.closest(".md-btn");
    if (btn) {
      const box = btn.closest(".md-editor-box");
      if (!box) return;
      const targetId = box.dataset.target;
      const textarea = document.getElementById(targetId);
      if (!textarea) return;

      const action = btn.dataset.action;
      const writeTab = box.querySelector('.md-tab[data-tab="write"]');
      if (writeTab && !writeTab.classList.contains("active")) {
        writeTab.click();
      }
      applyMarkdownToolbarAction(textarea, action);
      return;
    }

    // 3. Toggle All Preview on #reflection-form
    const toggleAllBtn = e.target.closest("#btn-toggle-all-preview");
    if (toggleAllBtn) {
      e.preventDefault();
      const boxes = document.querySelectorAll('#reflection-form .md-editor-box');
      const hasWrite = Array.from(boxes).some(b => {
        const wt = b.querySelector('.md-tab[data-tab="write"]');
        return wt && wt.classList.contains("active");
      });
      const targetMode = hasWrite ? "preview" : "write";
      boxes.forEach(b => {
        const targetTab = b.querySelector(`.md-tab[data-tab="${targetMode}"]`);
        if (targetTab) targetTab.click();
      });
      toggleAllBtn.textContent = targetMode === "preview" ? "Write All ✏️" : "Preview All 👁️";
      return;
    }

    // 4. Toggle All Preview on #edit-reflection-form
    const toggleEditAllBtn = e.target.closest("#btn-toggle-edit-all-preview");
    if (toggleEditAllBtn) {
      e.preventDefault();
      const boxes = document.querySelectorAll('#edit-reflection-form .md-editor-box');
      const hasWrite = Array.from(boxes).some(b => {
        const wt = b.querySelector('.md-tab[data-tab="write"]');
        return wt && wt.classList.contains("active");
      });
      const targetMode = hasWrite ? "preview" : "write";
      boxes.forEach(b => {
        const targetTab = b.querySelector(`.md-tab[data-tab="${targetMode}"]`);
        if (targetTab) targetTab.click();
      });
      toggleEditAllBtn.textContent = targetMode === "preview" ? "Write All ✏️" : "Preview All 👁️";
      return;
    }
  });
}

// ==========================================================================
// Edit Reflection Page Logic
// ==========================================================================
let cachedReflections = [];

async function loadEditReflectionView(targetId) {
  const emptyCard = document.getElementById("edit-reflection-empty");
  const editCard = document.getElementById("edit-reflection-card");

  try {
    const res = await fetch("/api/reflections");
    if (!res.ok) throw new Error("Could not load reflections.");
    cachedReflections = await res.json();
  } catch (err) {
    cachedReflections = [];
  }

  if (!cachedReflections.length) {
    if (emptyCard) emptyCard.classList.remove("hidden");
    if (editCard) editCard.classList.add("hidden");
    return;
  }

  let selected = null;
  if (targetId) {
    selected = cachedReflections.find(r => String(r.id) === String(targetId));
  }
  if (!selected) {
    selected = cachedReflections[0];
  }

  if (!selected) {
    if (emptyCard) emptyCard.classList.remove("hidden");
    if (editCard) editCard.classList.add("hidden");
    return;
  }

  if (emptyCard) emptyCard.classList.add("hidden");
  if (editCard) editCard.classList.remove("hidden");

  populateEditReflectionForm(selected);
}

function populateEditReflectionForm(item) {
  const titleEl = document.getElementById("edit-problem-title");
  if (titleEl) titleEl.textContent = `${item.contestId}${item.problemIndex} — ${item.problemName}`;

  const ratingEl = document.getElementById("edit-problem-rating");
  if (ratingEl) {
    ratingEl.textContent = item.rating ?? "—";
    ratingEl.className = ratingColorClass(item.rating);
  }

  const linkEl = document.getElementById("edit-problem-link");
  if (linkEl) {
    linkEl.href = safeHref(item.problemUrl) === "#" ? "#" : item.problemUrl;
    linkEl.textContent = `${item.problemUrl} ↗`;
  }

  const timeEl = document.getElementById("edit-problem-time");
  if (timeEl) {
    timeEl.textContent = isProblemTimeHidden(item.contestId, item.problemIndex)
      ? "--"
      : formatDuration(item.timeSpentSeconds || 0);
  }

  const editTagsEl = document.getElementById("edit-view-tags");
  if (editTagsEl) {
    const tags = item.tags || [];
    editTagsEl.innerHTML = tags.length
      ? `<div class="tags-list">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
      : `<span class="readonly">—</span>`;
  }

  const setValue = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setValue("edit-ref-id", item.id);
  setValue("edit-ref-contest-id", item.contestId);
  setValue("edit-ref-problem-index", item.problemIndex);
  setValue("edit-ref-problem-name", item.problemName);
  setValue("edit-ref-problem-url", item.problemUrl);
  setValue("edit-ref-rating", item.rating ?? "");
  setValue("edit-ref-tags", JSON.stringify(item.tags || []));
  setValue("edit-ref-time", item.timeSpentSeconds || 0);

  setValue("edit-q0", item.keyObservation || "");
  setValue("edit-q1", item.whatMadeMeStuck || "");
  setValue("edit-stuck-reason", item.stuckReason || "");
  setValue("edit-q2", item.pattern || "");
  setValue("edit-q3", item.futureTrigger || "");
  setValue("edit-q4", item.simplestImplementation || "");

  document.querySelectorAll('#edit-reflection-form .md-editor-box').forEach(b => {
    const writeTab = b.querySelector('.md-tab[data-tab="write"]');
    if (writeTab && !writeTab.classList.contains("active")) writeTab.click();
  });

  setEditSaveStatus("");
}

function setEditSaveStatus(text, error = false) {
  const el = document.getElementById("edit-save-status");
  if (!el) return;
  el.textContent = text;
  el.className = error ? "save-status error" : "save-status";
}

async function saveEditedReflection(event) {
  event.preventDefault();

  const contestId = Number(document.getElementById("edit-ref-contest-id")?.value);
  const problemIndex = document.getElementById("edit-ref-problem-index")?.value;
  const problemName = document.getElementById("edit-ref-problem-name")?.value;
  const problemUrl = document.getElementById("edit-ref-problem-url")?.value;
  const ratingVal = document.getElementById("edit-ref-rating")?.value;
  const rating = ratingVal ? Number(ratingVal) : null;
  const timeSpentSeconds = Number(document.getElementById("edit-ref-time")?.value) || 0;

  let tags = [];
  try {
    tags = JSON.parse(document.getElementById("edit-ref-tags")?.value || "[]");
  } catch (_) {}

  const answers = [0, 1, 2, 3, 4].map(i =>
    document.getElementById(`edit-q${i}`)?.value.trim() || ""
  );

  if (answers.some(a => !a)) {
    setEditSaveStatus("Please answer all five reflection questions.", true);
    return;
  }

  const payload = {
    contestId,
    problemIndex,
    problemName,
    rating,
    tags,
    problemUrl,
    timeSpentSeconds,
    keyObservation: answers[0],
    whatMadeMeStuck: answers[1],
    stuckReason: document.getElementById("edit-stuck-reason")?.value || null,
    pattern: answers[2],
    futureTrigger: answers[3],
    simplestImplementation: answers[4]
  };

  const submitBtn = event.target.querySelector("button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
  }

  try {
    const res = await fetch("/api/reflections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      setEditSaveStatus(data.error || "Failed to update reflection.", true);
      return;
    }

    setEditSaveStatus("Reflection updated successfully!");
    await loadHistory();

    const idx = cachedReflections.findIndex(r => r.contestId === contestId && r.problemIndex === problemIndex);
    if (idx !== -1) {
      cachedReflections[idx] = { ...cachedReflections[idx], ...payload };
    }
  } catch (err) {
    setEditSaveStatus("Error updating reflection: " + err.message, true);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
  }
}

const editFormEl = document.getElementById("edit-reflection-form");
if (editFormEl) {
  editFormEl.addEventListener("submit", saveEditedReflection);
}

/* ==========================================================================
   Manage Database Problems Page
   ========================================================================== */
let manageProblemsCache = [];
let manageHideTime = localStorage.getItem("cf_manage_hide_time") === "true";

function updateManageTimeButton() {
  const toggleBtn = document.getElementById("btn-toggle-manage-time");
  if (!toggleBtn) return;
  if (manageHideTime) {
    toggleBtn.textContent = "Show Time";
    toggleBtn.title = "Show time spent on problems";
  } else {
    toggleBtn.textContent = "Hide Time";
    toggleBtn.title = "Hide time spent and show '--' dash instead";
  }
}

function setManageStatusMessage(msg, isError = false) {
  const el = document.getElementById("manage-status-msg");
  if (!el) return;
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    el.className = "message-banner hidden";
    return;
  }
  el.textContent = msg;
  el.className = `message-banner ${isError ? "error" : "success"}`;
  el.classList.remove("hidden");
}

// Database Records Overview: managePageSize rows per page (chosen in the
// sidebar, remembered in this browser), over the rows matching the search box
const MANAGE_PAGE_SIZES = [10, 25, 50, 100];
const MANAGE_PAGE_SIZE_KEY = "cr_manage_page_size";
let managePageSize = 25;
try {
  const saved = Number(localStorage.getItem(MANAGE_PAGE_SIZE_KEY));
  if (MANAGE_PAGE_SIZES.includes(saved)) managePageSize = saved;
} catch (_) {}
let managePage = 1;

function manageSearchQuery() {
  return (document.getElementById("manage-search-input")?.value || "").trim().toLowerCase();
}

function filteredManageProblems() {
  const q = manageSearchQuery();
  if (!q) return manageProblemsCache;
  return manageProblemsCache.filter(p =>
    `${p.contestId}${p.index}`.toLowerCase().includes(q) ||
    (p.name || "").toLowerCase().includes(q)
  );
}

// Redraws the table and pager. Keeps the current page (moving back if it no
// longer exists, e.g. after deleting its last row) unless resetPage.
function renderManageTable({ resetPage = false } = {}) {
  const rows = filteredManageProblems();
  const totalPages = Math.max(1, Math.ceil(rows.length / managePageSize));
  managePage = resetPage ? 1 : Math.min(Math.max(1, managePage), totalPages);
  const start = (managePage - 1) * managePageSize;
  const pageRows = rows.slice(start, start + managePageSize);
  renderManageTableRows(pageRows, { searching: Boolean(manageSearchQuery()) && manageProblemsCache.length > 0 });

  const pagerEl = document.getElementById("manage-pagination");
  if (!pagerEl) return;
  if (!rows.length) {
    pagerEl.innerHTML = "";
    return;
  }
  pagerEl.innerHTML = `
    <div class="manage-pagination-count">Showing ${start + 1}–${start + pageRows.length} of ${rows.length}</div>
    ${buildPagination(managePage, totalPages, "Database records pages")}`;
  pagerEl.querySelectorAll(".cf-pagination a.cf-page").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      managePage = Number(link.dataset.page);
      renderManageTable();
      document.getElementById("manage-records-caption")?.scrollIntoView({ block: "nearest" });
    });
  });
}

function renderManageTableRows(problems, { searching = false } = {}) {
  const tbody = document.getElementById("manage-problems-body");
  if (!tbody) return;

  if (!problems.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #888; padding: 24px;">
          ${searching ? "No problems match your search." : "No problems found anywhere in the database."}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = problems.map(p => {
    const isHidden = isProblemTimeHidden(p.contestId, p.index);
    const solvedDate = p.solvedAt || (p.inJournal ? (p.createdAt || p.updatedAt) : null);
    return `
    <tr data-key="${escapeAttribute(`${p.contestId}_${p.index}`)}">
      <td style="text-align: center;">
        <a href="${safeHref(p.url)}" target="_blank" rel="noopener">${escapeHtml(`${p.contestId}${p.index}`)}</a>
      </td>
      <td style="text-align: left;">
        <a href="${safeHref(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a>
      </td>
      <td class="${ratingColorClass(p.rating)}" style="text-align: center; font-weight: bold;">
        <b>${p.rating ?? "—"}</b>
      </td>
      <td class="col-time" style="text-align: center; font-family: monospace; font-size: 12px; white-space: nowrap;">
        ${(manageHideTime || isHidden) ? "--" : formatDuration(p.timeSpentSeconds)}
      </td>
      <td class="col-solved-at" style="text-align: center; font-size: 12px; white-space: nowrap;">
        ${formatSolvedAtDate(solvedDate)}
      </td>
      <td class="col-row-actions">
        ${p.journalId ? `<a class="cf-row-action flag-edit-reflection" href="/edit-reflection?id=${encodeURIComponent(p.journalId)}" data-route="edit-reflection" title="Edit the written reflection">Edit reflection</a> ` : ""}<button type="button" class="cf-row-action flag-edit-time btn-edit-db-problem" data-contest="${escapeAttribute(p.contestId)}" data-index="${escapeAttribute(p.index)}" title="Edit time spent and date for this problem">Edit time</button> <button type="button" class="cf-row-action btn-toggle-problem-time ${isHidden ? "is-hidden" : ""}" data-contest="${escapeAttribute(p.contestId)}" data-index="${escapeAttribute(p.index)}" title="${isHidden ? "Show time for this problem" : "Hide time for this problem everywhere"}">${isHidden ? "Show time" : "Hide time"}</button> <button type="button" class="cf-row-action flag-delete-problem is-danger btn-delete-db-problem" data-contest="${escapeAttribute(p.contestId)}" data-index="${escapeAttribute(p.index)}" data-name="${escapeHtml(p.name)}" title="Permanently delete this problem">Delete</button>
      </td>
    </tr>
  `;
  }).join("");

  // Attach edit problem button listeners
  tbody.querySelectorAll(".btn-edit-db-problem").forEach(btn => {
    btn.addEventListener("click", () => {
      const contestId = btn.dataset.contest;
      const index = btn.dataset.index;
      const problem = manageProblemsCache.find(
        p => String(p.contestId) === String(contestId) && String(p.index).toUpperCase() === String(index).toUpperCase()
      );
      if (problem) {
        openManageEditModal(problem);
      }
    });
  });

  // Attach toggle problem time listeners
  tbody.querySelectorAll(".btn-toggle-problem-time").forEach(btn => {
    btn.addEventListener("click", () => {
      const contestId = btn.dataset.contest;
      const index = btn.dataset.index;
      toggleProblemTimeHidden(contestId, index);

      // Re-render current manage table rows
      renderManageTable();

      // Update time displays across the entire app
      renderQueueTable();
      applyJournalFilters();
      updateTimer();

      const editContestId = document.getElementById("edit-ref-contest-id")?.value;
      const editIndex = document.getElementById("edit-ref-problem-index")?.value;
      const editTimeEl = document.getElementById("edit-problem-time");
      const editTimeVal = Number(document.getElementById("edit-ref-time")?.value) || 0;
      if (editTimeEl && editContestId && editIndex) {
        editTimeEl.textContent = isProblemTimeHidden(editContestId, editIndex)
          ? "--"
          : formatDuration(editTimeVal);
      }
    });
  });

  // Attach delete button listeners
  tbody.querySelectorAll(".btn-delete-db-problem").forEach(btn => {
    btn.addEventListener("click", async () => {
      const contestId = btn.dataset.contest;
      const index = btn.dataset.index;
      const key = `${contestId}_${index}`;
      const name = btn.dataset.name;

      if (!confirm(`Permanently remove ${contestId}${index} ("${name}") from everywhere in the database?`)) {
        return;
      }

      btn.disabled = true;
      btn.textContent = "Deleting…";

      try {
        const res = await fetch(`/api/manage/problems/${contestId}/${index}`, {
          method: "DELETE"
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete");

        // 1. Clear from localStorage
        clearLocalStorageForProblem(key);

        // 2. Clear from state if present
        const wasActive = state.activeProblemId === key;
        state.problems = state.problems.filter(p => `${p.contestId}_${p.index}` !== key);
        if (wasActive) {
          pauseTimer();
          state.activeProblemId = null;
        }

        if (!state.problems.length) {
          clearLocalStorageQueueData();
        } else {
          saveQueueState();
        }

        renderProblemViews();
        await loadHistory();

        setManageStatusMessage(`Problem ${contestId}${index} removed from everywhere in the database.`);
        await loadManageProblemsView();
      } catch (err) {
        setManageStatusMessage("Error: " + err.message, true);
        btn.disabled = false;
        btn.textContent = "Delete";
      }
    });
  });
}

function formatForDateTimeLocal(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function updateManageEditTimePreview() {
  const h = Math.max(0, parseInt(document.getElementById("manage-edit-hours")?.value, 10) || 0);
  const m = Math.max(0, parseInt(document.getElementById("manage-edit-mins")?.value, 10) || 0);
  const s = Math.max(0, parseInt(document.getElementById("manage-edit-secs")?.value, 10) || 0);
  const totalSeconds = h * 3600 + m * 60 + s;
  const previewEl = document.getElementById("manage-edit-time-preview");
  if (previewEl) {
    previewEl.textContent = `Duration: ${formatDuration(totalSeconds)} (${totalSeconds}s)`;
  }
}

function openManageEditModal(problem) {
  const modal = document.getElementById("manage-edit-modal");
  if (!modal) return;

  initManageEditModal();

  const contestIdInput = document.getElementById("manage-edit-contest-id");
  const indexInput = document.getElementById("manage-edit-index");
  const infoEl = document.getElementById("manage-edit-problem-info");
  const hoursInput = document.getElementById("manage-edit-hours");
  const minsInput = document.getElementById("manage-edit-mins");
  const secsInput = document.getElementById("manage-edit-secs");
  const dateInput = document.getElementById("manage-edit-datetime");
  const errorEl = document.getElementById("manage-edit-error");

  if (contestIdInput) contestIdInput.value = problem.contestId;
  if (indexInput) indexInput.value = problem.index;

  if (infoEl) {
    infoEl.textContent = `${problem.contestId}${problem.index} — ${problem.name}`;
  }

  const totalSecs = Math.max(0, Number(problem.timeSpentSeconds) || 0);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;

  if (hoursInput) hoursInput.value = h;
  if (minsInput) minsInput.value = m;
  if (secsInput) secsInput.value = s;

  updateManageEditTimePreview();

  const problemDate = problem.solvedAt || problem.date || problem.updatedAt || problem.addedAt;
  if (dateInput) {
    dateInput.value = formatForDateTimeLocal(problemDate);
  }

  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  modal.classList.remove("hidden");
}

function closeManageEditModal() {
  const modal = document.getElementById("manage-edit-modal");
  if (modal) modal.classList.add("hidden");
}

function initManageEditModal() {
  const modal = document.getElementById("manage-edit-modal");
  if (!modal || modal._initialized) return;
  modal._initialized = true;

  const closeBtn = document.getElementById("btn-close-manage-edit-modal");
  const cancelBtn = document.getElementById("btn-cancel-manage-edit");
  const form = document.getElementById("manage-edit-form");
  const zeroBtn = document.getElementById("btn-manage-edit-zero-time");
  const nowBtn = document.getElementById("btn-manage-edit-now");
  const hoursInput = document.getElementById("manage-edit-hours");
  const minsInput = document.getElementById("manage-edit-mins");
  const secsInput = document.getElementById("manage-edit-secs");
  const errorEl = document.getElementById("manage-edit-error");
  const saveBtn = document.getElementById("btn-save-manage-edit");

  closeBtn?.addEventListener("click", closeManageEditModal);
  cancelBtn?.addEventListener("click", closeManageEditModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeManageEditModal();
  });

  [hoursInput, minsInput, secsInput].forEach(inp => {
    inp?.addEventListener("input", updateManageEditTimePreview);
  });

  zeroBtn?.addEventListener("click", () => {
    if (hoursInput) hoursInput.value = 0;
    if (minsInput) minsInput.value = 0;
    if (secsInput) secsInput.value = 0;
    updateManageEditTimePreview();
  });

  nowBtn?.addEventListener("click", () => {
    const dateInput = document.getElementById("manage-edit-datetime");
    if (dateInput) {
      dateInput.value = formatForDateTimeLocal(new Date().toISOString());
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const contestId = document.getElementById("manage-edit-contest-id")?.value;
    const index = document.getElementById("manage-edit-index")?.value;
    if (!contestId || !index) return;

    const h = Math.max(0, parseInt(hoursInput?.value, 10) || 0);
    const m = Math.max(0, parseInt(minsInput?.value, 10) || 0);
    const s = Math.max(0, parseInt(secsInput?.value, 10) || 0);
    const newSeconds = h * 3600 + m * 60 + s;

    const dtVal = document.getElementById("manage-edit-datetime")?.value;
    const isoDate = dtVal ? new Date(dtVal).toISOString() : new Date().toISOString();

    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }

    try {
      const res = await fetch(`/api/manage/problems/${contestId}/${index}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeSpentSeconds: newSeconds,
          date: isoDate
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update problem.");

      // Update state if problem in state.problems
      const key = `${contestId}_${index}`;
      const inState = state.problems.find(p => `${p.contestId}_${p.index}` === key);
      if (inState) {
        inState.timeSpentSeconds = newSeconds;
        inState.addedAt = isoDate;
      }
      if (state.activeProblemId === key) {
        state.timerSeconds = newSeconds;
        updateTimer();
      }
      saveQueueState();

      // Close modal
      closeManageEditModal();

      // Refresh data and UI
      await loadHistory();
      renderQueueTable();
      updateTimer();

      const editContestId = document.getElementById("edit-ref-contest-id")?.value;
      const editIndex = document.getElementById("edit-ref-problem-index")?.value;
      if (editContestId == contestId && editIndex == index) {
        const editTimeInput = document.getElementById("edit-ref-time");
        if (editTimeInput) editTimeInput.value = newSeconds;
        const editTimeEl = document.getElementById("edit-problem-time");
        if (editTimeEl) {
          editTimeEl.textContent = isProblemTimeHidden(contestId, index) ? "--" : formatDuration(newSeconds);
        }
      }

      setManageStatusMessage(`Problem ${contestId}${index} time and date updated successfully.`);
      await loadManageProblemsView();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = "Error: " + err.message;
        errorEl.classList.remove("hidden");
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    }
  });
}

async function loadManageProblemsView() {
  const summaryEl = document.getElementById("manage-summary-text");
  const searchInput = document.getElementById("manage-search-input");
  const wipeBtn = document.getElementById("btn-wipe-all-db");

  try {
    const res = await fetch("/api/manage/problems");
    if (!res.ok) throw new Error("Could not load database records.");
    const data = await res.json();
    manageProblemsCache = data.problems || [];

    if (summaryEl) {
      summaryEl.textContent = `Found ${data.totalCount} problem${data.totalCount === 1 ? "" : "s"} across database (${data.reflectionsCount} reflections, ${data.queueCount} in queue).`;
    }

    renderManageTable();
  } catch (err) {
    if (summaryEl) summaryEl.textContent = "Error loading database problems.";
    manageProblemsCache = [];
    renderManageTable({ resetPage: true });
    setManageStatusMessage(err.message, true);
  }

  initManageEditModal();
  updateManageTimeButton();

  // Setup toggle time listener once
  const toggleTimeBtn = document.getElementById("btn-toggle-manage-time");
  if (toggleTimeBtn && !toggleTimeBtn._initialized) {
    toggleTimeBtn._initialized = true;
    toggleTimeBtn.addEventListener("click", () => {
      manageHideTime = !manageHideTime;
      localStorage.setItem("cf_manage_hide_time", String(manageHideTime));
      updateManageTimeButton();

      renderManageTable();
    });
  }

  // Page size: a display preference, remembered in this browser
  const pageSizeSelect = document.getElementById("manage-page-size");
  if (pageSizeSelect && !pageSizeSelect._initialized) {
    pageSizeSelect._initialized = true;
    pageSizeSelect.value = String(managePageSize);
    pageSizeSelect.addEventListener("change", () => {
      const size = Number(pageSizeSelect.value);
      if (!MANAGE_PAGE_SIZES.includes(size)) return;
      managePageSize = size;
      try {
        localStorage.setItem(MANAGE_PAGE_SIZE_KEY, String(size));
      } catch (_) {}
      renderManageTable({ resetPage: true });
    });
  }

  // Setup search filter listener once
  if (searchInput && !searchInput._initialized) {
    searchInput._initialized = true;
    searchInput.addEventListener("input", () => renderManageTable({ resetPage: true }));
  }

  // Setup wipe all listener once
  if (wipeBtn && !wipeBtn._initialized) {
    wipeBtn._initialized = true;
    wipeBtn.addEventListener("click", async () => {
      if (!confirm("⚠️ DANGER: Are you sure you want to permanently delete ALL problems and reflections from everywhere in the database? This action CANNOT be undone.")) {
        return;
      }

      wipeBtn.disabled = true;
      wipeBtn.textContent = "Wiping…";

      try {
        const res = await fetch("/api/manage/problems", { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to wipe database.");

        clearLocalStorageQueueData();
        try { localStorage.removeItem(STORAGE_KEYS.HIDDEN_TIME_PROBLEMS); } catch (_) {}
        pauseTimer();
        state.activeProblemId = null;
        state.problems = [];
        renderProblemViews();
        await loadHistory();

        setManageStatusMessage("All problems and reflections have been wiped from everywhere in the database.");
        await loadManageProblemsView();
      } catch (err) {
        setManageStatusMessage("Error wiping database: " + err.message, true);
      } finally {
        wipeBtn.disabled = false;
        wipeBtn.textContent = "Delete";
      }
    });
  }
}

function initTheme() {
  const toggleBtn = document.getElementById("btn-theme-toggle");
  if (!toggleBtn) return;

  function updateThemeUI(theme) {
    const isDark = theme === "dark";
    const icon = toggleBtn.querySelector(".theme-icon");
    const text = toggleBtn.querySelector(".theme-text");
    if (icon) icon.textContent = isDark ? "☀️" : "🌙";
    if (text) text.textContent = isDark ? "Light Theme" : "Dark Theme";
    toggleBtn.title = isDark ? "Switch to light theme" : "Switch to dark theme";
    toggleBtn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
  updateThemeUI(currentTheme);

  toggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const newTheme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    try {
      localStorage.setItem("cf_theme", newTheme);
    } catch (_) {}
    updateThemeUI(newTheme);
  });
}

// Header signal (top right): round trip between the app server and MongoDB (measured on the
// server), with the full page -> server -> database time in its tooltip.
// Measured after the page loads, every minute while the tab is visible, and
// on click.
const DB_LATENCY_GOOD_MS = 50;
const DB_LATENCY_OK_MS = 150;
let dbLatencyBusy = false;

async function measureDbLatency() {
  const pill = document.getElementById("db-latency");
  if (!pill || dbLatencyBusy) return;
  dbLatencyBusy = true;
  const text = pill.querySelector(".db-latency-text");
  pill.classList.add("is-measuring");
  try {
    const started = performance.now();
    // Not through the shared-read cache: every measurement is a fresh request
    const res = await nativeFetch("/api/db-ping", { cache: "no-store" });
    const totalMs = Math.round(performance.now() - started);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.dbMs !== "number") throw new Error(data.error || `HTTP ${res.status}`);

    const dbMs = data.dbMs;
    const level = dbMs < DB_LATENCY_GOOD_MS ? "is-good" : dbMs < DB_LATENCY_OK_MS ? "is-ok" : "is-slow";
    pill.classList.remove("is-good", "is-ok", "is-slow", "is-error");
    pill.classList.add(level);
    const shown = `${dbMs < 10 ? dbMs.toFixed(1) : Math.round(dbMs)} ms`;
    text.textContent = shown;
    pill.setAttribute("aria-label", `Database latency: ${shown}`);
    pill.title = [
      `Server ↔ database round trip: ${dbMs} ms (median of ${data.samples.join(", ")} ms)`,
      `This page ↔ server ↔ database: ${totalMs} ms`,
      data.region ? `Server region: ${data.region}` : null,
      `Measured ${new Date().toLocaleTimeString()}. Click to measure again.`
    ].filter(Boolean).join("\n");
  } catch (err) {
    pill.classList.remove("is-good", "is-ok", "is-slow");
    pill.classList.add("is-error");
    text.textContent = "offline";
    pill.setAttribute("aria-label", "Database offline");
    pill.title = `Could not reach the database: ${String(err.message).replace(/\.+$/, "")}. Click to try again.`;
  } finally {
    pill.classList.remove("is-measuring");
    dbLatencyBusy = false;
  }
}

function initDbLatency() {
  const pill = document.getElementById("db-latency");
  if (!pill) return;
  pill.addEventListener("click", measureDbLatency);
  // After the page's own data, so the first reading isn't competing with it
  setTimeout(measureDbLatency, 1500);
  setInterval(() => {
    if (!document.hidden) measureDbLatency();
  }, 60000);
}

// Initial bootstrap
// Shows "Log out" in the header when the server requires a password
async function initSession() {
  try {
    // The login gate in index.html already asked; reuse its answer
    const session = await (window.__sessionCheck || fetch("/api/session").then(res => (res.ok ? res.json() : null)));
    if (!session) return;
    const { authEnabled } = session;
    const logout = document.getElementById("btn-logout");
    if (!logout || !authEnabled) return;
    logout.classList.remove("hidden");
    logout.addEventListener("click", async (event) => {
      event.preventDefault();
      await fetch("/api/logout", { method: "POST" });
      location.href = "/login";
    });
  } catch (_) {}
}

async function initApp() {
  prefetchApiReads();
  initTheme();
  initSession();
  initDbLatency();
  await Promise.all([loadStuckReasons(), syncQueueFromDb()]);
  renderProblemViews();
  updateTimer();

  initNavigation();
  setupMarkdownEditors();

  if (state.problem) {
    const hasPrevious = await restoreReflection();
    if (!hasPrevious) {
      if (state.problem.timerRunning) {
        startTimer();
      } else {
        pauseTimer();
      }
    } else {
      pauseTimer({ clearWasSolving: true });
    }
  }

  loadHistory();
}

window.addEventListener("beforeunload", syncActiveProblemTimeToDb);
initApp();
