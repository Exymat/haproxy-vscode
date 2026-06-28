#!/usr/bin/env node
/**
 * Regenerate test/bench/thresholds.json maxMs values from a vitest bench report.
 *
 * threshold = baseline + max(
 *   absoluteFloorMs,
 *   relativeMargin × baseline,
 *   statisticalMarginMs
 * )
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const reportPath = process.argv[2] ?? join(repoRoot, "scripts/reports/bench-latest.json");
const thresholdsPath = join(repoRoot, "test/bench/thresholds.json");

const DEFAULT_FORMULA = {
  absoluteFloorMs: 1,
  relativeMargin: 0.15,
};

const DEFAULT_DERIVED = {
  tokenize: {
    minLines: 500,
    absoluteFloorMsPerLine: 0.01,
  },
};

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
          p995: bench.p995 ?? bench.p99 ?? bench.mean ?? 0,
          moe: bench.moe ?? 0,
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

function computeThresholdMs(baselineMs, statisticalMarginMs, formula) {
  const margin = Math.max(
    formula.absoluteFloorMs,
    formula.relativeMargin * baselineMs,
    statisticalMarginMs,
  );
  return Math.ceil(baselineMs + margin);
}

function computeThresholdPerLine(baselineMsPerLine, statisticalMarginMsPerLine, formula, derived) {
  const margin = Math.max(
    derived.absoluteFloorMsPerLine,
    formula.relativeMargin * baselineMsPerLine,
    statisticalMarginMsPerLine,
  );
  return Math.ceil((baselineMsPerLine + margin) * 1000) / 1000;
}

function main() {
  const report = loadJson(reportPath);
  const config = loadJson(thresholdsPath);
  const benchmarks = collectBenchmarks(report);
  const formula = { ...DEFAULT_FORMULA, ...(config.formula ?? {}) };
  const derivedDefaults = {
    ...DEFAULT_DERIVED.tokenize,
    ...(config.derived?.tokenize ?? {}),
  };

  console.log(`Updating thresholds from ${reportPath}`);
  console.log(
    `Formula: baseline + max(${formula.absoluteFloorMs} ms, ${formula.relativeMargin} × baseline, statisticalMarginMs)`,
  );
  console.log("");

  let updatedRules = 0;

  for (const rule of config.thresholds ?? []) {
    const matches = benchmarks.filter((bench) => matchesRule(bench.name, rule));
    if (matches.length === 0) {
      console.warn(`[skip] No report entry for rule: ${rule.name ?? rule.namePattern}`);
      continue;
    }

    const thresholds = matches.map((bench) => computeThresholdMs(bench.p995, bench.moe, formula));
    const baselineMs = Math.max(...matches.map((bench) => bench.p995));
    const statisticalMarginMs = Math.max(...matches.map((bench) => bench.moe));
    const maxMs = Math.max(...thresholds);

    rule.baselineMs = Math.ceil(baselineMs * 1000) / 1000;
    rule.statisticalMarginMs = Math.ceil(statisticalMarginMs * 10000) / 10000;
    rule.maxMs = maxMs;
    updatedRules += 1;

    console.log(
      `[update] ${rule.name ?? rule.namePattern}: baseline=${rule.baselineMs}ms → maxMs=${maxMs}ms (${matches.length} match(es))`,
    );
  }

  const tokenizeMatches = benchmarks.filter(
    (bench) => bench.name.startsWith("tokenize ") && parseLineCount(bench.name),
  );
  const tokenizeLarge = tokenizeMatches.filter((bench) => {
    const lines = parseLineCount(bench.name);
    return lines >= (derivedDefaults.minLines ?? 500);
  });

  if (tokenizeLarge.length > 0) {
    const perLineThresholds = tokenizeLarge.map((bench) => {
      const lines = parseLineCount(bench.name);
      const baselineMsPerLine = bench.p995 / lines;
      const statisticalMarginMsPerLine = bench.moe / lines;
      return computeThresholdPerLine(
        baselineMsPerLine,
        statisticalMarginMsPerLine,
        formula,
        derivedDefaults,
      );
    });
    const maxMsPerLine = Math.max(...perLineThresholds);

    config.derived ??= {};
    config.derived.tokenize = {
      minLines: derivedDefaults.minLines,
      absoluteFloorMsPerLine: derivedDefaults.absoluteFloorMsPerLine,
      maxMsPerLine,
    };
    console.log(`[update] derived.tokenize.maxMsPerLine=${maxMsPerLine}`);
  }

  config.metric = config.metric ?? "p995";
  config.formula = formula;

  writeFileSync(thresholdsPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("");
  console.log(`Wrote ${updatedRules} threshold rule(s) to ${thresholdsPath}`);
}

main();
