// Copies KaTeX and Google Code Prettify into public/vendor so Vercel's CDN can
// serve them (node_modules isn't served there). Locally, Express serves the
// same paths straight from node_modules, so this is only needed for deploys.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const copies = [
  ["node_modules/katex/dist/katex.min.js", "public/vendor/katex/katex.min.js"],
  ["node_modules/katex/dist/katex.min.css", "public/vendor/katex/katex.min.css"],
  ["node_modules/katex/dist/fonts", "public/vendor/katex/fonts"],
  ["node_modules/code-prettify/src/prettify.js", "public/vendor/prettify/prettify.js"]
];

for (const [from, to] of copies) {
  const source = path.join(root, from);
  const target = path.join(root, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  console.log(`copied ${from} -> ${to}`);
}
