#!/usr/bin/env node
/**
 * Cross-platform dev launcher — runs `next dev` and tees all output into
 * dev.log.
 *
 * Replaces the Unix-only `next dev -p 3000 2>&1 | tee dev.log` pipe, which
 * crashes on Windows ("bun: command not found: tee"). Runs identically under
 * Node.js (`node scripts/dev.mjs`) or Bun (`bun scripts/dev.mjs`) — the Next
 * CLI is spawned via process.execPath, so whichever runtime executes this file
 * also runs Next (no `node` requirement for bun-only machines, no .cmd shim /
 * shell quirks on Windows).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "3000";
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!fs.existsSync(nextCli)) {
  console.error("Next.js is not installed — run `bun install` / `npm install` first.");
  process.exit(1);
}

// truncate on each start — keep dev.log fresh and small
const log = fs.createWriteStream(path.join(root, "dev.log"), { flags: "w" });

const child = spawn(process.execPath, [nextCli, "dev", "-p", port], {
  cwd: root,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

function tap(stream, out) {
  stream.on("data", (chunk) => {
    out.write(chunk);
    log.write(chunk);
  });
}
tap(child.stdout, process.stdout);
tap(child.stderr, process.stderr);

child.on("exit", (code) => {
  log.end();
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
