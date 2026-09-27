import crypto from "node:crypto";
import { promisify } from "node:util";

// Password hashing with scrypt (built into Node): salted and deliberately slow
// and memory-hungry, so a leaked hash is expensive to guess from.
//
// Format: scrypt:<N>:<r>:<p>:<salt>:<hash>, salt and hash base64url. No "$",
// so it can be pasted into a shell or the Vercel dashboard as is.
const scrypt = promisify(crypto.scrypt);

const DEFAULTS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const PREFIX = "scrypt";

// scrypt needs 128 * N * r bytes; allow that plus headroom over Node's 32 MB default
const maxmem = (N, r) => 128 * N * r * 2;

export async function hashPassword(password) {
  const { N, r, p } = DEFAULTS;
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(String(password), salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) });
  return [PREFIX, N, r, p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

// { N, r, p, salt, key } or null when the string isn't a hash in this format
export function parseHash(stored) {
  const parts = String(stored || "").trim().split(":");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  const valid =
    Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 20 && (N & (N - 1)) === 0 &&
    Number.isInteger(r) && r >= 1 && r <= 32 &&
    Number.isInteger(p) && p >= 1 && p <= 16 &&
    salt.length >= 16 && key.length >= 16;
  return valid ? { N, r, p, salt, key } : null;
}

export async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const { N, r, p, salt, key } = parsed;
  const candidate = await scrypt(String(password), salt, key.length, { N, r, p, maxmem: maxmem(N, r) });
  return crypto.timingSafeEqual(candidate, key);
}
