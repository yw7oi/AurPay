#!/usr/bin/env node
/**
 * Cross-platform dev launcher — runs `next dev -p 3000` and tees all output
 * into dev.log.
 *
 * Replaces the Unix-only `next dev -p 3000 2>&1 | tee dev.log` pipe, which
 * crashes on Windows ("bun: command not found: tee") and therefore never
 * starts the frontend at all. Same behavior on every OS, no `tee` needed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

// truncate on each start — keep dev.log fresh and small
const log = fs.createWriteStream(path.join(root, "dev.log"), { flags: "w" });

const nextBin = path.join(root, "node_modules", ".bin", isWin ? "next.cmd" : "next");
const port = process.env.PORT ?? "3000";
const child = spawn(nextBin, ["dev", "-p", port], {
  cwd: root,
  shell: isWin, // .cmd shims on Windows need a shell
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
