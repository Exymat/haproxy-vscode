#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import {
  FIXTURES_ENV,
  cleanupStagedFixtures,
  stageIntegrationFixtures,
} from "./lib/integration-fixtures.mjs";

process.env.HAPROXY_PERF_BENCH = "1";

const compile = spawnSync("npm", ["run", "compile"], { stdio: "inherit", shell: true });
if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const compileIntegration = spawnSync("npm", ["run", "compile:integration"], {
  stdio: "inherit",
  shell: true,
});
if (compileIntegration.status !== 0) {
  process.exit(compileIntegration.status ?? 1);
}

const { tempDir, fixturesDir } = stageIntegrationFixtures();

try {
  const tests = spawnSync("npx", ["vscode-test", "-g", "Perf"], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      HAPROXY_PERF_BENCH: "1",
      [FIXTURES_ENV]: fixturesDir,
    },
  });
  if (tests.status !== 0) {
    process.exit(tests.status ?? 1);
  }
} finally {
  cleanupStagedFixtures(tempDir);
}

const check = spawnSync(
  "node",
  ["scripts/check-perf-integration-thresholds.mjs", "scripts/reports/perf-integration.json"],
  { stdio: "inherit", shell: true },
);
process.exit(check.status ?? 1);
