import { collections } from "../db/database.js";

const { profile } = collections;

// The journal has one owner, so there is a single profile document
const PROFILE_ID = "me";
// `codeforces` holds what the last sync with Codeforces returned
const FIELDS = ["handle", "name", "city", "country", "photo", "codeforces"];

function mapDoc(doc) {
  const result = {};
  for (const field of FIELDS) result[field] = doc?.[field] ?? null;
  return result;
}

export async function getProfile() {
  return mapDoc(await profile.findOne({ _id: PROFILE_ID }));
}

// Sets the given fields (a null value clears one); the others stay as they are
export async function updateProfile(changes) {
  const set = {};
  for (const field of FIELDS) {
    if (field in changes) set[field] = changes[field];
  }
  if (Object.keys(set).length) {
    await profile.updateOne({ _id: PROFILE_ID }, { $set: set }, { upsert: true });
  }
  return getProfile();
}
