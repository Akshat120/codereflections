import { collections, nextIds } from "../db/database.js";

const { blogPosts } = collections;

// Fields returned by the API, in order
const FIELDS = ["id", "title", "body", "tags", "createdAt", "updatedAt"];

function mapDoc(doc) {
  if (!doc) return null;
  const post = {};
  for (const field of FIELDS) post[field] = doc[field] ?? null;
  post.tags = Array.isArray(doc.tags) ? doc.tags : [];
  return post;
}

// Newest first
export async function findAllPosts() {
  const docs = await blogPosts.find({}, { sort: { createdAt: -1, id: -1 } }).toArray();
  return docs.map(mapDoc);
}

export async function findPostById(id) {
  return mapDoc(await blogPosts.findOne({ id }));
}

export async function createPost({ title, body, tags }) {
  const now = new Date().toISOString();
  const id = await nextIds("blog_posts");
  await blogPosts.insertOne({ id, title, body, tags, createdAt: now, updatedAt: now });
  return findPostById(id);
}

// Returns the updated post, or null when there is no post with this id
export async function updatePost(id, { title, body, tags }) {
  const updated = await blogPosts.updateOne(
    { id },
    { $set: { title, body, tags, updatedAt: new Date().toISOString() } }
  );
  return updated.matchedCount ? findPostById(id) : null;
}

// Returns whether a post was deleted
export async function deletePost(id) {
  const deleted = await blogPosts.deleteOne({ id });
  return deleted.deletedCount > 0;
}
