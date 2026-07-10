#!/usr/bin/env node
/**
 * Validate vitest bench JSON output against test/bench/thresholds.json.
 * Prints per-line tokenization rates and exits non-zero on regression.
 *
 * Thresholds are derived from baselines via:
 *   threshold = baseline + max(absoluteFloorMs, relativeMargin × baseline, statisticalMarginMs)
 * Regenerate with: npm run bench:update-thresholds [--conservative]
 * Default aggregation dismisses IQR outliers then uses max of retained; --conservative keeps global max.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const reportPath = process.argv[2] ?? join(repoRoot, "scripts/reports/bench-latest.json");
const thresholdsPath = join(repoRoot, "test/bench/thresholds.json");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function collectBenchmarks(report) {
  const results = [];
  for (const file of report.files ?? []) {
    for (const group of file.groups ?? []) {
      for (const bench of group.benchmarks ?? []) {
        if (bench.sampleCount === undefined || bench.sampleCount === 0) {
          continue;
        }
        results.push({
          name: bench.name,
          mean: bench.mean ?? 0,
          median: bench.median ?? 0,
          p995: bench.p995 ?? bench.p99 ?? bench.mean ?? 0,
          sampleCount: bench.sampleCount,
        });
      }
    }
  }
  return results;
}

function parseLineCount(name) {
  const match = name.match(/\((\d+) lines\)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function matchesRule(name, rule) {
  if (rule.name) {
    return name === rule.name;
  }
  if (rule.namePattern) {
    return new RegExp(rule.namePattern).test(name);
  }
  return false;
}

function main() {
  const report = loadJson(reportPath);
  const config = loadJson(thresholdsPath);
  const benchmarks = collectBenchmarks(report);
  const failures = [];
  const derived = config.derived ?? {};

  console.log(`Benchmark threshold check: ${reportPath}`);
  console.log("");

  for (const bench of benchmarks) {
    const lineCount = parseLineCount(bench.name);
    let suffix = "";
    if (lineCount && bench.name.startsWith("tokenize ")) {
      const msPerLine = bench.p995 / lineCount;
      const linesPerSec = bench.p995 > 0 ? (lineCount / bench.p995) * 1000 : 0;
      suffix = ` | ${msPerLine.toFixed(4)} ms/line, ${linesPerSec.toFixed(0)} lines/s (p99.5)`;
      const tokenizeDerived = derived.tokenize;
      if (
        tokenizeDerived?.maxMsPerLine &&
        lineCount >= (tokenizeDerived.minLines ?? 500) &&
        msPerLine > tokenizeDerived.maxMsPerLine
      ) {
        failures.push({
          name: bench.name,
          actual: msPerLine,
          limit: tokenizeDerived.maxMsPerLine,
          unit: "ms/line",
        });
      }
    }

    const rule = (config.thresholds ?? []).find((entry) => matchesRule(bench.name, entry));
    if (rule) {
      const actual = bench.p995;
      const status = actual <= rule.maxMs ? "ok" : "FAIL";
      const baselineHint = rule.baselineMs !== undefined ? `, baseline ${rule.baselineMs}ms` : "";
      console.log(
        `[${status}] ${bench.name}: p99.5=${actual.toFixed(3)}ms (limit ${rule.maxMs}ms${baselineHint})${suffix}`,
      );
      if (actual > rule.maxMs) {
        failures.push({
          name: bench.name,
          actual,
          limit: rule.maxMs,
          unit: "ms",
        });
      }
    } else if (suffix) {
      console.log(`[info] ${bench.name}: p99.5=${bench.p995.toFixed(3)}ms${suffix}`);
    }
  }

  console.log("");
  if (failures.length === 0) {
    console.log("All configured thresholds passed.");
    return;
  }

  console.error(`${failures.length} threshold(s) exceeded:`);
  for (const failure of failures) {
    console.error(
      `  - ${failure.name}: ${failure.actual.toFixed(3)} ${failure.unit} > ${failure.limit} ${failure.unit}`,
    );
  }
  process.exit(1);
}

main();
