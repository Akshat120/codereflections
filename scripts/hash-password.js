// Makes the value for APP_PASSWORD_HASH, so the login password itself is never
// stored anywhere (not in Vercel, not in .env):
//
//   npm run hash-password
//
// Type the password twice (it isn't shown), then paste the printed line into
// Vercel → Settings → Environment Variables as APP_PASSWORD_HASH, delete
// APP_PASSWORD there, and redeploy. Can also read the password from a pipe.
import { hashPassword, verifyPassword } from "../src/passwordHash.js";

const MIN_LENGTH = 12;

// Reads one line without echoing it (shows * per character) on a terminal;
// from a pipe it just reads the next line. Keys typed (or pasted) past the
// end of a line are kept for the next question.
let typedAhead = "";

function readSecret(question) {
  const input = process.stdin;
  if (!input.isTTY) return readPipedLine(question);
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    let value = "";
    input.setRawMode(true);
    input.setEncoding("utf8");
    const onData = chunk => {
      const chars = [...chunk];
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === "\r" || char === "\n") {
          let rest = chars.slice(i + 1).join("");
          if (char === "\r" && rest.startsWith("\n")) rest = rest.slice(1);
          typedAhead = rest;
          done();
          return resolve(value);
        }
        if (char === "\u0003") { // Ctrl+C
          done();
          return reject(new Error("Cancelled."));
        }
        if (char === "\u007f" || char === "\b") { // Backspace
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          process.stdout.write("*");
        }
      }
    };
    const done = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    input.on("data", onData);
    if (typedAhead) {
      const pending = typedAhead;
      typedAhead = "";
      onData(pending);
    }
    if (input.listenerCount("data")) input.resume();
  });
}

let pipedLines = null;
async function readPipedLine(question) {
  process.stdout.write(question + "\n");
  if (!pipedLines) {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    pipedLines = text.split(/\r?\n/);
  }
  return pipedLines.shift() ?? "";
}

async function main() {
  const password = await readSecret("New password: ");
  if (!password) throw new Error("No password given.");
  if (password !== password.trim()) {
    throw new Error("The password starts or ends with a space; that is easy to mistype. Try again.");
  }
  const again = await readSecret("Same password again: ");
  if (again !== password) throw new Error("The two passwords don't match. Nothing was changed.");
  if (password.length < MIN_LENGTH) {
    console.warn(`Warning: ${password.length} characters is short; ${MIN_LENGTH}+ (or a passphrase) is much harder to guess.`);
  }

  const hash = await hashPassword(password);
  if (!(await verifyPassword(password, hash))) throw new Error("Self-check failed; please report this.");

  console.log("\nAdd this in Vercel → Settings → Environment Variables (Production and Preview):\n");
  console.log(`APP_PASSWORD_HASH=${hash}`);
  console.log("\nThen delete APP_PASSWORD there and redeploy. Existing sessions end; log in with the new password.");
  console.log("(Locally: export APP_PASSWORD_HASH='<the value above>' before npm run dev.)");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
