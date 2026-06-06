#!/usr/bin/env node
/**
 * Run compare-haproxy-c across all supported HAProxy versions.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const compareScript = join(__dirname, "compare-haproxy-c.mjs");
const versions = ["2.6", "2.8", "3.0", "3.2", "3.4"];
const targets = [
  { name: "tests-conf", parts: ["tests", "conf"] },
  { name: "examples", parts: ["examples"] },
];

const confRoot = resolve(process.env.HAPROXY_CONF_ROOT ?? join(extensionRoot, "..", "haproxy_git"));
const reportDir = resolve(process.env.HAPROXY_COMPARE_REPORT_DIR ?? join(__dirname, "reports"));

function parseArgs(argv) {
  let runtime = process.env.HAPROXY_RUNTIME ?? "local";
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === "--runtime") {
      runtime = argv[idx + 1] ?? runtime;
      idx += 1;
    }
  }
  return { runtime };
}

const { runtime } = parseArgs(process.argv.slice(2));

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
    }
  }
}

if (failures > 0) {
  console.error(`\nMatrix comparison failed in ${failures} run(s).`);
  process.exit(1);
}

console.log(`\nMatrix comparison passed for all versions (runtime=${runtime}).`);
