import crypto from "node:crypto";
import { Router } from "express";
import { blockedMinutes, clearFailures, clientIp, recordFailure } from "./loginLimiter.js";

// Single-user password login. Set APP_PASSWORD to enable it (always required on
// Vercel). A successful login sets a signed, HttpOnly session cookie.
const COOKIE_NAME = "cr_session";
const SESSION_DAYS = 30;

function password() {
  return process.env.APP_PASSWORD || "";
}

export function authEnabled() {
  return Boolean(password());
}

// On Vercel the API refuses to run without a password rather than exposing data.
function authMisconfigured() {
  return Boolean(process.env.VERCEL) && !authEnabled();
}

// Signing key: SESSION_SECRET if given, otherwise derived from the password, so
// changing the password logs out every existing session.
function signingKey() {
  return process.env.SESSION_SECRET || crypto.createHash("sha256").update(`cr-session:${password()}`).digest("hex");
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
  res.json({ authEnabled: authEnabled(), loggedIn: isLoggedIn(req) });
});

authRoutes.post("/login", async (req, res) => {
  if (authMisconfigured()) {
    return res.status(503).json({ error: "APP_PASSWORD is not set on the server." });
  }
  if (!authEnabled()) {
    return res.json({ ok: true });
  }

  const ip = clientIp(req);
  const wait = await blockedMinutes(ip);
  if (wait) {
    res.setHeader("Retry-After", String(wait * 60));
    return res.status(429).json({ error: `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` });
  }

  // Compare fixed-length hashes so timing doesn't reveal the password length
  const given = crypto.createHash("sha256").update(String(req.body?.password || "")).digest("hex");
  const expected = crypto.createHash("sha256").update(password()).digest("hex");
  if (!safeEqual(given, expected)) {
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
  if (authMisconfigured()) {
    return res.status(503).json({ error: "APP_PASSWORD is not set on the server." });
  }
  if (!isLoggedIn(req)) {
    return res.status(401).json({ error: "Please log in." });
  }
  return next();
}
