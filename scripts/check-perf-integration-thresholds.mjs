#!/usr/bin/env node
/**
 * Validate integration perf JSON output against test/bench/perf-integration-thresholds.json.
 * Exits non-zero when any benchmark exceeds its configured p95 limit.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const reportPath = process.argv[2] ?? join(repoRoot, "scripts/reports/perf-integration.json");
const thresholdsPath = join(repoRoot, "test/bench/perf-integration-thresholds.json");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function main() {
  const report = loadJson(reportPath);
  const config = loadJson(thresholdsPath);
  const failures = [];

  console.log(`Integration perf threshold check: ${reportPath}`);
  console.log("");

  for (const entry of report.benchmarks ?? []) {
    const rule = (config.thresholds ?? []).find((candidate) => candidate.name === entry.name);
    if (!rule) {
      console.log(`[info] ${entry.name}: no threshold configured`);
      continue;
    }

    const actual = entry.stats?.p95 ?? entry.stats?.mean ?? 0;
    const status = actual <= rule.maxMs ? "ok" : "FAIL";
    const baselineHint = rule.baselineMs !== undefined ? `, baseline ${rule.baselineMs}ms` : "";
    console.log(
      `[${status}] ${entry.name}: p95=${actual.toFixed(3)}ms (limit ${rule.maxMs}ms${baselineHint})`,
    );
    if (actual > rule.maxMs) {
      failures.push({
        name: entry.name,
        actual,
        limit: rule.maxMs,
      });
    }
  }

  console.log("");
  if (failures.length === 0) {
    console.log("All configured integration perf thresholds passed.");
    return;
  }

  console.error(`${failures.length} threshold(s) exceeded:`);
  for (const failure of failures) {
    console.error(`  - ${failure.name}: ${failure.actual.toFixed(3)}ms > ${failure.limit}ms`);
  }
  process.exit(1);
}

main();
