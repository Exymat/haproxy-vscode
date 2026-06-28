#!/usr/bin/env node
/**
 * Regenerate test/bench/thresholds.json maxMs values from one or more vitest bench reports.
 *
 * Aggregates across reports by taking the max p995 and max moe per benchmark name, then:
 *   threshold = baseline + max(
 *     absoluteFloorMs,
 *     relativeMargin × baseline,
 *     statisticalMarginMs
 *   )
 *   maxMs = roundUpClean(threshold)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const defaultReportPath = join(repoRoot, "scripts/reports/bench-latest.json");
const reportPaths = process.argv.length > 2 ? process.argv.slice(2) : [defaultReportPath];
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

/** Merge multiple reports: conservative baseline = max p995 and max moe per benchmark. */
function mergeBenchmarkReports(reports) {
  const merged = new Map();
  for (const report of reports) {
    for (const bench of collectBenchmarks(report)) {
      const existing = merged.get(bench.name);
      if (!existing) {
        merged.set(bench.name, { ...bench });
        continue;
      }
      existing.p995 = Math.max(existing.p995, bench.p995);
      existing.moe = Math.max(existing.moe, bench.moe);
    }
  }
  return [...merged.values()];
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
  return baselineMs + margin;
}

function computeThresholdPerLine(baselineMsPerLine, statisticalMarginMsPerLine, formula, derived) {
  const margin = Math.max(
    derived.absoluteFloorMsPerLine,
    formula.relativeMargin * baselineMsPerLine,
    statisticalMarginMsPerLine,
  );
  return baselineMsPerLine + margin;
}

/** Round up to a human-friendly limit: ×10 (≥100 ms), ×5 (≥10 ms), even (≥2 ms), else 2. */
function roundUpClean(ms) {
  if (ms >= 100) {
    return Math.ceil(ms / 10) * 10;
  }
  if (ms >= 10) {
    return Math.ceil(ms / 5) * 5;
  }
  if (ms >= 2) {
    return Math.ceil(ms / 2) * 2;
  }
  return 2;
}

/** Round up per-line limits to 0.01 ms/line (≥0.1) or 0.005 ms/line (≥0.01). */
function roundUpCleanPerLine(msPerLine) {
  if (msPerLine >= 0.1) {
    return Math.ceil(msPerLine * 100) / 100;
  }
  if (msPerLine >= 0.01) {
    return Math.ceil(msPerLine * 200) / 200;
  }
  return Math.ceil(msPerLine * 1000) / 1000;
}

function verifyReports(reports, config) {
  const failures = [];
  for (const report of reports) {
    const benchmarks = collectBenchmarks(report);
    for (const bench of benchmarks) {
      const rule = (config.thresholds ?? []).find((entry) => matchesRule(bench.name, entry));
      if (rule && bench.p995 > rule.maxMs) {
        failures.push({
          report: report.__sourcePath,
          name: bench.name,
          p995: bench.p995,
          limit: rule.maxMs,
        });
      }

      const lineCount = parseLineCount(bench.name);
      const tokenizeDerived = config.derived?.tokenize;
      if (
        lineCount &&
        bench.name.startsWith("tokenize ") &&
        tokenizeDerived?.maxMsPerLine &&
        lineCount >= (tokenizeDerived.minLines ?? 500)
      ) {
        const msPerLine = bench.p995 / lineCount;
        if (msPerLine > tokenizeDerived.maxMsPerLine) {
          failures.push({
            report: report.__sourcePath,
            name: bench.name,
            p995: msPerLine,
            limit: tokenizeDerived.maxMsPerLine,
            unit: "ms/line",
          });
        }
      }
    }
  }
  return failures;
}

function main() {
  const reports = reportPaths.map((path) => {
    const report = loadJson(path);
    report.__sourcePath = path;
    return report;
  });
  const config = loadJson(thresholdsPath);
  const benchmarks = mergeBenchmarkReports(reports);
  const formula = { ...DEFAULT_FORMULA, ...(config.formula ?? {}) };
  const derivedDefaults = {
    ...DEFAULT_DERIVED.tokenize,
    ...(config.derived?.tokenize ?? {}),
  };

  console.log(`Updating thresholds from ${reports.length} report(s):`);
  for (const path of reportPaths) {
    console.log(`  - ${path}`);
  }
  console.log(
    `Formula: baseline + max(${formula.absoluteFloorMs} ms, ${formula.relativeMargin} × baseline, statisticalMarginMs)`,
  );
  console.log("Rounding: ×10 (≥100 ms), ×5 (≥10 ms), even (≥2 ms), min 2 ms");
  console.log("");

  let updatedRules = 0;

  for (const rule of config.thresholds ?? []) {
    const matches = benchmarks.filter((bench) => matchesRule(bench.name, rule));
    if (matches.length === 0) {
      console.warn(`[skip] No report entry for rule: ${rule.name ?? rule.namePattern}`);
      continue;
    }

    const rawThresholds = matches.map((bench) =>
      computeThresholdMs(bench.p995, bench.moe, formula),
    );
    const baselineMs = Math.max(...matches.map((bench) => bench.p995));
    const statisticalMarginMs = Math.max(...matches.map((bench) => bench.moe));
    const rawMaxMs = Math.max(...rawThresholds);
    const maxMs = roundUpClean(rawMaxMs);

    rule.baselineMs = Math.ceil(baselineMs * 1000) / 1000;
    rule.statisticalMarginMs = Math.ceil(statisticalMarginMs * 10000) / 10000;
    rule.maxMs = maxMs;
    updatedRules += 1;

    const rounded = maxMs !== Math.ceil(rawMaxMs) ? ` (raw ${rawMaxMs.toFixed(2)} → ${maxMs})` : "";
    console.log(
      `[update] ${rule.name ?? rule.namePattern}: baseline=${rule.baselineMs}ms → maxMs=${maxMs}ms${rounded} (${matches.length} match(es))`,
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
    const rawMaxMsPerLine = Math.max(...perLineThresholds);
    const maxMsPerLine = roundUpCleanPerLine(rawMaxMsPerLine);

    config.derived ??= {};
    config.derived.tokenize = {
      minLines: derivedDefaults.minLines,
      absoluteFloorMsPerLine: derivedDefaults.absoluteFloorMsPerLine,
      maxMsPerLine,
    };
    const rounded =
      maxMsPerLine !== rawMaxMsPerLine
        ? ` (raw ${rawMaxMsPerLine.toFixed(4)} → ${maxMsPerLine})`
        : "";
    console.log(`[update] derived.tokenize.maxMsPerLine=${maxMsPerLine}${rounded}`);
  }

  config.metric = config.metric ?? "p995";
  config.formula = formula;

  writeFileSync(thresholdsPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("");
  console.log(`Wrote ${updatedRules} threshold rule(s) to ${thresholdsPath}`);

  const failures = verifyReports(reports, config);
  if (failures.length === 0) {
    console.log("All source reports pass the updated thresholds.");
    return;
  }

  console.error(`${failures.length} measurement(s) exceed updated thresholds:`);
  for (const failure of failures) {
    const unit = failure.unit ?? "ms";
    console.error(
      `  - [${failure.report}] ${failure.name}: ${failure.p995.toFixed(3)} ${unit} > ${failure.limit} ${unit}`,
    );
  }
  process.exit(1);
}

main();
