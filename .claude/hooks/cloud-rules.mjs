// SessionStart hook: in a cloud session, print one part of the standing rules from this
// repo's claude-rules branch (published by System\Code\Setup\cloudsync.py on the laptop).
// Exits silently elsewhere, where the root CLAUDE.md already applies.
import { execFileSync } from "node:child_process";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);

const part = process.argv[2] ?? "1";
const git = (...args) => execFileSync("git", args, {
  cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

try {
  // One ref per part, because both parts run in parallel.
  git("fetch", "--quiet", "--no-write-fetch-head", "origin",
    `+refs/heads/claude-rules:refs/cloud-rules/part${part}`);
  process.stdout.write(git("show", `refs/cloud-rules/part${part}:part${part}.md`));
} catch {
  console.log(`Standing rules part ${part} did not load (claude-rules branch unreadable). Say so in the first reply.`);
}
