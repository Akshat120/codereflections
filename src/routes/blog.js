import { Router } from "express";
import {
  createPost,
  deletePost,
  findAllPosts,
  findPostById,
  updatePost
} from "../repositories/blogRepository.js";
import { requireAllowed } from "../featureFlags.js";
import { parseTags } from "../validation.js";

// The private blog: free-form notes in Markdown. Like the rest of the API it
// sits behind the login (src/app.js), so entries are never public.
export const blogRoutes = Router();

const TITLE_MAX = 200;
const BODY_MAX = 50000;

// Returns { post } (cleaned) or { error }
function parsePost(body) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const tags = parseTags(body?.tags);
  if (!title) return { error: "title is required." };
  if (title.length > TITLE_MAX) return { error: `title is too long (at most ${TITLE_MAX} characters).` };
  if (!text) return { error: "body is required." };
  if (text.length > BODY_MAX) return { error: `body is too long (at most ${BODY_MAX} characters).` };
  if (!tags) return { error: "tags must be a list of short strings." };
  return { post: { title, body: text, tags: [...new Set(tags)] } };
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

blogRoutes.get("/", async (_req, res) => {
  try {
    return res.json(await findAllPosts());
  } catch (_) {
    return res.status(500).json({ error: "Could not load blog entries from the database." });
  }
});

blogRoutes.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid blog entry ID." });

  try {
    const post = await findPostById(id);
    if (!post) return res.status(404).json({ error: "Blog entry not found." });
    return res.json(post);
  } catch (_) {
    return res.status(500).json({ error: "Could not load this blog entry from the database." });
  }
});

blogRoutes.post("/", async (req, res) => {
  const { post, error } = parsePost(req.body);
  if (error) return res.status(400).json({ error });

  try {
    return res.status(201).json(await createPost(post));
  } catch (_) {
    return res.status(500).json({ error: "Could not save the blog entry to the database." });
  }
});

blogRoutes.put("/:id", requireAllowed("editBlog"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid blog entry ID." });
  const { post, error } = parsePost(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const updated = await updatePost(id, post);
    if (!updated) return res.status(404).json({ error: "Blog entry not found." });
    return res.json(updated);
  } catch (_) {
    return res.status(500).json({ error: "Could not save the blog entry to the database." });
  }
});

blogRoutes.delete("/:id", requireAllowed("deleteBlog"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid blog entry ID." });

  try {
    if (!(await deletePost(id))) return res.status(404).json({ error: "Blog entry not found." });
    return res.json({ success: true, id });
  } catch (_) {
    return res.status(500).json({ error: "Could not delete the blog entry from the database." });
  }
});
