#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  FIXTURES_ENV,
  cleanupStagedFixtures,
  stageIntegrationFixtures,
} from "./lib/integration-fixtures.mjs";

function gitPorcelain() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(result.stderr || "git status failed");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function assertNoNewChanges(before, after) {
  if (before === after) {
    console.log("No new tracked file changes from integration tests.");
    return;
  }

  console.error("Integration tests changed tracked files.");
  const beforeLines = new Set(before.split(/\r?\n/).filter(Boolean));
  const newOrChanged = after
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !beforeLines.has(line));
  if (newOrChanged.length > 0) {
    console.error(newOrChanged.join("\n"));
  } else {
    console.error(after.trim());
  }
  process.exit(1);
}

const statusBefore = gitPorcelain();
const { tempDir, fixturesDir } = stageIntegrationFixtures();

try {
  const tests = spawnSync("npx", ["vscode-test", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      [FIXTURES_ENV]: fixturesDir,
    },
  });
  if (tests.status !== 0) {
    process.exit(tests.status ?? 1);
  }

  assertNoNewChanges(statusBefore, gitPorcelain());
} finally {
  cleanupStagedFixtures(tempDir);
}
