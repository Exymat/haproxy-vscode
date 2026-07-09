#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error(result.stderr || "git status failed");
  process.exit(result.status ?? 1);
}

const dirty = result.stdout.trim();
if (dirty) {
  console.error("Git worktree is not clean:");
  console.error(dirty);
  process.exit(1);
}

console.log("Git worktree is clean.");
