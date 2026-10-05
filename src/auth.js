import crypto from "node:crypto";
import { Router } from "express";
import { blockedMinutes, clearFailures, clientIp, recordFailure } from "./loginLimiter.js";
import { featureFlags } from "./featureFlags.js";
import { parseHash, verifyPassword } from "./passwordHash.js";

// Single-user password login (always required on Vercel). A successful login
// sets a signed, HttpOnly session cookie.
//
// The password is set with APP_PASSWORD_HASH: an scrypt hash made by
// `npm run hash-password`, so the password itself is stored nowhere.
// APP_PASSWORD (the password in plain text) still works when no hash is set.
const COOKIE_NAME = "cr_session";
const SESSION_DAYS = 30;

function passwordHash() {
  return (process.env.APP_PASSWORD_HASH || "").trim();
}

function plainPassword() {
  return process.env.APP_PASSWORD || "";
}

export function authEnabled() {
  return Boolean(passwordHash() || plainPassword());
}

// Why login can't work, or null. On Vercel the API refuses to run without a
// password rather than exposing data; a malformed hash locks everyone out
// with a clear message instead of silently accepting nothing.
function authConfigError() {
  if (passwordHash() && !parseHash(passwordHash())) {
    return "APP_PASSWORD_HASH is not a valid hash. Generate one with: npm run hash-password";
  }
  if ((process.env.VERCEL || process.env.CF_WORKER) && !authEnabled()) {
    return "No password is set on the server (APP_PASSWORD_HASH).";
  }
  return null;
}

// Signing key: SESSION_SECRET if given, otherwise derived from the stored
// hash (random salt + scrypt output, so a captured cookie can't be used to
// guess the password offline) or, without a hash, from the plain password.
// Changing the password therefore logs out every existing session.
function signingKey() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const basis = passwordHash() || plainPassword();
  return crypto.createHash("sha256").update(`cr-session:${basis}`).digest("hex");
}

async function passwordMatches(given) {
  if (passwordHash()) return verifyPassword(given, passwordHash());
  // Plain APP_PASSWORD: compare fixed-length digests so timing doesn't
  // reveal the password's length
  const a = crypto.createHash("sha256").update(given).digest("hex");
  const b = crypto.createHash("sha256").update(plainPassword()).digest("hex");
  return safeEqual(a, b);
}

function sign(value) {
  return crypto.createHmac("sha256", signingKey()).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function createToken() {
  const expiresAt = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expiresAt}.${sign(expiresAt)}`;
}

function validToken(token) {
  if (!token) return false;
  const [expiresAt, signature] = String(token).split(".");
  if (!expiresAt || !signature) return false;
  return safeEqual(signature, sign(expiresAt)) && Number(expiresAt) > Date.now();
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isHttps(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function isLoggedIn(req) {
  return !authEnabled() || validToken(readCookie(req, COOKIE_NAME));
}

export const authRoutes = Router();

authRoutes.get("/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // Misconfigured (e.g. no password set on Vercel / Cloudflare): send the
  // visitor to the login page, which shows what to fix, not to the app
  const configError = authConfigError();
  if (configError) return res.json({ authEnabled: true, loggedIn: false, error: configError });
  res.json({ authEnabled: authEnabled(), loggedIn: isLoggedIn(req), features: featureFlags() });
});

authRoutes.post("/login", async (req, res) => {
  const configError = authConfigError();
  if (configError) return res.status(503).json({ error: configError });
  if (!authEnabled()) {
    return res.json({ ok: true });
  }

  const ip = clientIp(req);
  const wait = await blockedMinutes(ip);
  if (wait) {
    res.setHeader("Retry-After", String(wait * 60));
    return res.status(429).json({ error: `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` });
  }

  const given = req.body?.password;
  if (typeof given !== "string" || given.length > 1024 || !(await passwordMatches(given))) {
    await recordFailure(ip);
    await new Promise(resolve => setTimeout(resolve, 600)); // slow down guessing
    return res.status(401).json({ error: "Wrong password." });
  }

  await clearFailures(ip);

  setSessionCookie(req, res, createToken(), SESSION_DAYS * 24 * 60 * 60);
  return res.json({ ok: true });
});

authRoutes.post("/logout", (req, res) => {
  setSessionCookie(req, res, "", 0);
  res.json({ ok: true });
});

// Guards every other /api route
export function requireAuth(req, res, next) {
  const configError = authConfigError();
  if (configError) return res.status(503).json({ error: configError });
  if (!isLoggedIn(req)) {
    return res.status(401).json({ error: "Please log in." });
  }
  return next();
}
