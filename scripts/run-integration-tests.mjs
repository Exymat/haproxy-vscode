#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  FIXTURES_ENV,
  FOLDER_SCOPED_WORKSPACE_ENV,
  USER_DATA_DIR_ENV,
  WORKSPACE_ENV,
  cleanupStagedFixtures,
  stageIntegrationFixtures,
} from "./lib/integration-fixtures.mjs";

const SHARD_GREP = {
  smoke: "Activation smoke|Provider command smoke|Version bundle smoke",
  workspace: "Workspace symbols E2E",
  settings: "Diagnostics lifecycle|Folder-scoped HAProxy version",
};

function parseArgs(argv) {
  const passthrough = [];
  let shard = process.env.HAPROXY_INTEGRATION_SHARD;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--shard" || arg === "--suite") && argv[index + 1]) {
      shard = argv[index + 1];
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }

  if (!shard) {
    return passthrough;
  }
  const grep = SHARD_GREP[shard];
  if (!grep) {
    console.error(
      `Unknown integration shard '${shard}'. Expected: ${Object.keys(SHARD_GREP).join(", ")}`,
    );
    process.exit(1);
  }
  return ["--grep", grep, ...passthrough];
}

function gitPorcelain() {
  const result = spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    if ((result.stderr ?? "").includes("dubious ownership")) {
      console.warn(
        "Skipping integration clean-worktree guard because Git rejected sandbox ownership.",
      );
      return null;
    }
    console.error(result.stderr || "git status failed");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function assertNoNewChanges(before, after) {
  if (before === null || after === null) {
    return;
  }
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
const { tempDir, fixturesDir, workspace, userDataDir } = stageIntegrationFixtures();
const vscodeTestBin = process.platform === "win32" ? "npx.cmd" : "npx";
const vscodeTestArgs = ["vscode-test", ...parseArgs(process.argv.slice(2))];

try {
  const tests = spawnSync(vscodeTestBin, vscodeTestArgs, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      [FIXTURES_ENV]: fixturesDir,
      [WORKSPACE_ENV]: workspace,
      [FOLDER_SCOPED_WORKSPACE_ENV]: workspace,
      [USER_DATA_DIR_ENV]: userDataDir,
    },
  });
  if (tests.status !== 0) {
    process.exit(tests.status ?? 1);
  }

  assertNoNewChanges(statusBefore, gitPorcelain());
} finally {
  cleanupStagedFixtures(tempDir);
}
