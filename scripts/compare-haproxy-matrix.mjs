#!/usr/bin/env node
/**
 * Run compare-haproxy-c across all supported HAProxy versions.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { SUPPORTED_VERSIONS } from "./lib/versions.mjs";
import { parseVersionArgs } from "./lib/cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const compareScript = join(__dirname, "compare-haproxy-c.mjs");
const versions = SUPPORTED_VERSIONS;
const targets = [
  { name: "tests-conf", parts: ["tests", "conf"] },
  { name: "examples", parts: ["examples"] },
];

const confRoot = resolve(process.env.HAPROXY_CONF_ROOT ?? join(extensionRoot, "..", "haproxy_git"));
const reportDir = resolve(process.env.HAPROXY_COMPARE_REPORT_DIR ?? join(__dirname, "reports"));

const { runtime } = parseVersionArgs(process.argv.slice(2));

if (!existsSync(reportDir)) {
  mkdirSync(reportDir, { recursive: true });
}

let failures = 0;
for (const version of versions) {
  for (const target of targets) {
    const confDir = join(confRoot, `haproxy-${version}`, ...target.parts);
    const reportPath = join(reportDir, `compare-haproxy-c-${version}-${target.name}.json`);
    console.log(`\n=== Comparing HAProxy ${version} (${target.name}) ===`);
    const result = spawnSync(
      process.execPath,
      [compareScript, confDir, reportPath, "--version", version, "--runtime", runtime],
      { stdio: "inherit", env: process.env },
    );
    if (result.status !== 0) {
      failures += 1;
      if (result.status === 2) {
        console.error("\nMatrix comparison stopped: HAProxy runtime is unavailable.");
        process.exit(2);
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nMatrix comparison failed in ${failures} run(s).`);
  process.exit(1);
}

console.log(`\nMatrix comparison passed for all versions (runtime=${runtime}).`);
