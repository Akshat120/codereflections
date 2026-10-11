import { Router } from "express";
import { getProfile, updateProfile } from "../repositories/profileRepository.js";
import { getUserInfo } from "../services/codeforces.js";

// The owner's profile card: a handle, name, place and photo, optionally
// filled in from their public Codeforces profile. Private like the rest of
// the API.
export const profileRoutes = Router();

const TEXT_LIMITS = { handle: 24, name: 60, city: 60, country: 60 };
// Codeforces-style handle
const HANDLE_PATTERN = /^[A-Za-z0-9_.-]+$/;
// The page shrinks the photo to a small square before sending it, as a data
// URL; it is stored with the profile, so the size is kept well under the
// request limit
const PHOTO_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_MAX = 90000;

// Returns { changes } with only the fields that were sent, or { error }
function parseChanges(body) {
  if (!body || typeof body !== "object") return { error: "Send the profile fields to change." };
  const changes = {};

  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    if (!(field in body)) continue;
    const value = body[field] == null ? "" : String(body[field]).trim();
    if (value.length > max) return { error: `${field} is too long (at most ${max} characters).` };
    if (field === "handle" && value && !HANDLE_PATTERN.test(value)) {
      return { error: "handle may only contain letters, digits, underscore, dot and dash." };
    }
    changes[field] = value || null;
  }

  if ("photo" in body) {
    const photo = body.photo;
    if (photo == null || photo === "") {
      changes.photo = null;
    } else if (typeof photo !== "string" || photo.length > PHOTO_MAX || !PHOTO_PATTERN.test(photo)) {
      return { error: "photo must be a small JPEG, PNG or WebP image." };
    } else {
      changes.photo = photo;
    }
  }

  if (!Object.keys(changes).length) return { error: "Nothing to update." };
  return { changes };
}

profileRoutes.get("/", async (_req, res) => {
  try {
    return res.json(await getProfile());
  } catch (_) {
    return res.status(500).json({ error: "Could not load the profile from the database." });
  }
});

profileRoutes.put("/", async (req, res) => {
  const { changes, error } = parseChanges(req.body);
  if (error) return res.status(400).json({ error });

  try {
    return res.json(await updateProfile(changes));
  } catch (_) {
    return res.status(500).json({ error: "Could not save the profile to the database." });
  }
});

// Codeforces sends avatar links with or without the scheme; only its own
// image hosts are accepted, since the link ends up in an <img>
function avatarUrl(value) {
  const url = typeof value === "string" && value.startsWith("//") ? `https:${value}` : value;
  return typeof url === "string" && url.length <= 300 &&
    /^https:\/\/([a-z0-9-]+\.)*codeforces\.(org|com)\/[^\s"'<>`]+$/i.test(url)
    ? url
    : null;
}

const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const integer = value => (Number.isInteger(value) ? value : null);

// Looks the handle up on Codeforces and stores what the card shows from its
// public profile: rating, rank and avatar. Name and place are taken over when
// Codeforces has them. Nothing else (no submissions
// or contest history) is read.
profileRoutes.post("/sync", async (req, res) => {
  const handle = typeof req.body?.handle === "string" ? req.body.handle.trim() : "";
  if (!handle || handle.length > TEXT_LIMITS.handle || !HANDLE_PATTERN.test(handle)) {
    return res.status(400).json({ error: "Enter your Codeforces handle (letters, digits, underscore, dot, dash)." });
  }

  let user;
  try {
    user = await getUserInfo(handle);
  } catch (error) {
    return res.status(503).json({
      error: "Codeforces is temporarily unavailable. Try again later.",
      detail: error.message
    });
  }
  if (!user) {
    return res.status(404).json({ error: `No Codeforces user with the handle "${handle}".` });
  }

  const changes = {
    handle: text(user.handle, TEXT_LIMITS.handle) ?? handle,
    codeforces: {
      handle: text(user.handle, TEXT_LIMITS.handle) ?? handle,
      rating: integer(user.rating),
      maxRating: integer(user.maxRating),
      rank: text(user.rank, 40),
      maxRank: text(user.maxRank, 40),
      photo: avatarUrl(user.titlePhoto),
      syncedAt: new Date().toISOString()
    }
  };
  const name = text([user.firstName, user.lastName].filter(Boolean).join(" "), TEXT_LIMITS.name);
  if (name) changes.name = name;
  if (text(user.city, TEXT_LIMITS.city)) changes.city = text(user.city, TEXT_LIMITS.city);
  if (text(user.country, TEXT_LIMITS.country)) changes.country = text(user.country, TEXT_LIMITS.country);

  try {
    return res.json(await updateProfile(changes));
  } catch (_) {
    return res.status(500).json({ error: "Could not save the profile to the database." });
  }
});
