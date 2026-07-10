#!/usr/bin/env node
/**
 * Regenerate test/bench/thresholds.json maxMs values from one or more vitest bench reports.
 *
 * Default aggregation dismisses sporadic CI spikes (Tukey IQR fence), then:
 *   baseline = max p995 among remaining (non-outlier) samples
 *   threshold = baseline + max(
 *     absoluteFloorMs,
 *     relativeMargin × baseline,
 *     statisticalMarginMs
 *   )
 *   maxMs = roundUpClean(threshold)
 *
 * Usage:
 *   node scripts/update-bench-thresholds.mjs [--downloads [dir]] [--conservative] [report.json ...]
 *
 * --conservative  use global max p995 (legacy behaviour, no outlier filtering)
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const thresholdsPath = join(repoRoot, "test/bench/thresholds.json");
const defaultReportPath = join(repoRoot, "scripts/reports/bench-latest.json");

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

const MIN_SAMPLES_FOR_ROBUST = 5;

/** Prefix patterns for auto-added rules (longest match wins when grouping). */
const AUTO_GUARD_PATTERNS = [
  { namePattern: "^tokenize large-valid\\.cfg", derive: "tokenize" },
  { namePattern: "^tokenize large-mixed\\.cfg", derive: "tokenize" },
  { namePattern: "^diagnostics cold: large-valid\\.cfg \\(" },
  { namePattern: "^diagnostics warm: large-valid\\.cfg \\(" },
  { namePattern: "^diagnostics edit: large-valid\\.cfg \\(" },
  { namePattern: "^diagnostics cold: large-valid\\.cfg unusedSymbols" },
  { namePattern: "^diagnostics warm: large-valid\\.cfg unusedSymbols" },
  { namePattern: "^diagnostics edit: large-valid\\.cfg unusedSymbols" },
  { namePattern: "^diagnostics cold: large-mixed\\.cfg \\(" },
  { namePattern: "^diagnostics warm: large-mixed\\.cfg \\(" },
  { namePattern: "^diagnostics edit: large-mixed\\.cfg \\(" },
  { namePattern: "^diagnostics cold: large-mixed\\.cfg unusedSymbols" },
  { namePattern: "^diagnostics warm: large-mixed\\.cfg unusedSymbols" },
  { namePattern: "^diagnostics edit: large-mixed\\.cfg unusedSymbols" },
  { namePattern: "^diagnostics cold: log-format validation" },
  { namePattern: "^diagnostics warm: log-format validation" },
  { namePattern: "^format: large-(valid|mixed)\\.cfg" },
  { namePattern: "^document symbols: large-valid\\.cfg" },
  { namePattern: "^completion: large-valid\\.cfg" },
  { namePattern: "^completion: log-format" },
  { namePattern: "^hover warm:" },
  { namePattern: "^hover cold:" },
  { namePattern: "^definition: (cache-use|resolvers|inline ACL)" },
  { namePattern: "^references: peers section" },
  { namePattern: "^definition: large-valid\\.cfg" },
  { namePattern: "^references: large-valid\\.cfg" },
  { namePattern: "^definition warm: large-valid\\.cfg" },
  { namePattern: "^missing references warm: large-valid\\.cfg" },
  { namePattern: "^buildSymbolIndex cold: large-valid\\.cfg" },
  { namePattern: "^getSymbolIndex warm lookup: large-valid\\.cfg" },
  { namePattern: "^findSiteAtPosition warm: large-valid\\.cfg" },
  { namePattern: "^incremental reuse: single-line edit" },
  { namePattern: "^build workspace graph:" },
  { namePattern: "^discover workspace cfg files:" },
  { namePattern: "^load disk entry: read\\+index" },
  { namePattern: "^fingerprint \\d+ workspace documents" },
  { name: "loadSchemaBundle cold" },
  { namePattern: "^loadSchemaBundle cold \\(" },
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function parseArgs(argv) {
  const paths = [];
  let downloadsDir = null;
  let conservative = false;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--conservative") {
      conservative = true;
      continue;
    }
    if (arg === "--downloads") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-") && !next.endsWith(".json")) {
        downloadsDir = next;
        i += 1;
      } else {
        downloadsDir = join(homedir(), "Downloads");
      }
      continue;
    }
    if (statSync(arg, { throwIfNoEntry: false })?.isDirectory()) {
      paths.push(...discoverReportPaths(arg));
      continue;
    }
    paths.push(arg);
  }

  if (downloadsDir) {
    paths.push(...discoverReportPaths(downloadsDir));
  }

  if (paths.length === 0) {
    paths.push(defaultReportPath);
  }

  return {
    reportPaths: [...new Set(paths)].filter((path) => existsSync(path)),
    conservative,
  };
}

function discoverReportPaths(rootDir) {
  const paths = [];
  if (!existsSync(rootDir)) {
    return paths;
  }

  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/^bench-report(\(\d+\))?$/.test(entry.name)) {
          const reportPath = join(fullPath, "bench-latest.json");
          if (existsSync(reportPath)) {
            paths.push(reportPath);
          }
        }
        continue;
      }
      if (entry.isFile() && entry.name === "bench-latest.json" && /bench-report/i.test(dir)) {
        paths.push(fullPath);
      }
    }
  }

  return paths.sort((a, b) => {
    const num = (path) => Number.parseInt(path.match(/bench-report\((\d+)\)/)?.[1] ?? "0", 10);
    return num(a) - num(b);
  });
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

function mergeBenchmarkReports(reports) {
  const merged = new Map();
  for (const report of reports) {
    for (const bench of collectBenchmarks(report)) {
      const existing = merged.get(bench.name);
      if (!existing) {
        merged.set(bench.name, { ...bench, reportCount: 1 });
        continue;
      }
      existing.p995 = Math.max(existing.p995, bench.p995);
      existing.moe = Math.max(existing.moe, bench.moe);
      existing.reportCount += 1;
    }
  }
  return merged;
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Aggregate sample p995 values. Robust mode drops Tukey outliers then uses p90.
 * Returns outlier entries so verification can treat them as warnings.
 */
function aggregateSamples(samples, { conservative }) {
  if (samples.length === 0) {
    return null;
  }

  const rawMax = Math.max(...samples.map((sample) => sample.p995));

  if (conservative || samples.length < MIN_SAMPLES_FOR_ROBUST) {
    return {
      baselineMs: rawMax,
      statisticalMarginMs: Math.max(...samples.map((sample) => sample.moe)),
      rawMax,
      outliers: [],
      retained: samples,
      method: conservative ? "max" : "max (few samples)",
    };
  }

  const sortedP995 = [...samples.map((sample) => sample.p995)].sort((a, b) => a - b);
  const q1 = percentile(sortedP995, 25);
  const q3 = percentile(sortedP995, 75);
  const iqr = q3 - q1;
  const upperFence = q3 + 1.5 * iqr;

  const retained = iqr > 0 ? samples.filter((sample) => sample.p995 <= upperFence) : samples;
  const outliers = iqr > 0 ? samples.filter((sample) => sample.p995 > upperFence) : [];

  const pool = retained.length > 0 ? retained : samples;
  const poolP995 = [...pool.map((sample) => sample.p995)].sort((a, b) => a - b);
  // Max of non-outlier samples (p90 alone under-covers when variance is spread but not spiky).
  const baselineMs = poolP995[poolP995.length - 1];
  const p90 = percentile(poolP995, 90);

  return {
    baselineMs,
    statisticalMarginMs: Math.max(...pool.map((sample) => sample.moe)),
    rawMax,
    outliers,
    retained: pool,
    method:
      outliers.length > 0
        ? `robust max-of-retained=${baselineMs.toFixed(2)} ms (p90=${p90.toFixed(2)}, dismissed ${outliers.length} outlier(s), fence ${upperFence.toFixed(2)} ms)`
        : `robust max-of-retained=${baselineMs.toFixed(2)} ms (p90=${p90.toFixed(2)})`,
  };
}

function collectRuleSamples(reports, rule) {
  const samples = [];
  for (const report of reports) {
    for (const bench of collectBenchmarks(report)) {
      if (matchesRule(bench.name, rule)) {
        samples.push({
          name: bench.name,
          p995: bench.p995,
          moe: bench.moe,
          report: report.__sourcePath,
        });
      }
    }
  }
  return samples;
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

function ruleKey(rule) {
  return rule.name ?? rule.namePattern ?? "";
}

function isSmallFixture(name) {
  const lineCount = parseLineCount(name);
  return lineCount !== null && lineCount < 500;
}

function shouldGuardBenchmark(name, { p995 }) {
  if (name.includes(" edit baseline:")) {
    return false;
  }
  if (/ warm \(cached parse\)$/.test(name)) {
    return false;
  }
  if (name.startsWith("load disk entry: skip oversized")) {
    return false;
  }
  if (/^load(?:Schema|LanguageData) cold$/.test(name)) {
    return false;
  }
  if (isSmallFixture(name)) {
    return false;
  }

  if (AUTO_GUARD_PATTERNS.some((pattern) => matchesRule(name, pattern))) {
    return true;
  }

  return p995 >= 10;
}

function autoPatternFor(name) {
  const match = AUTO_GUARD_PATTERNS.find((pattern) => matchesRule(name, pattern));
  if (match) {
    const { name: exactName, namePattern, derive } = match;
    if (derive) {
      return { namePattern, derive };
    }
    if (exactName) {
      return { name: exactName };
    }
    return { namePattern };
  }
  return { namePattern: `^${escapeRegex(name)}$` };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncThresholdRules(config, benchmarkMap, totalReports) {
  const benchmarks = [...benchmarkMap.entries()].map(([name, stats]) => ({ name, ...stats }));
  const allNames = new Set(benchmarks.map((bench) => bench.name));

  const kept = [];
  const removed = [];
  for (const rule of config.thresholds ?? []) {
    const matches = benchmarks.filter((bench) => matchesRule(bench.name, rule));
    if (matches.length === 0) {
      removed.push(ruleKey(rule));
      continue;
    }
    if (matches.every((bench) => !shouldGuardBenchmark(bench.name, bench))) {
      removed.push(ruleKey(rule));
      continue;
    }
    kept.push(rule);
  }

  const added = [];
  const guardedNames = new Set();
  for (const rule of kept) {
    for (const name of allNames) {
      if (matchesRule(name, rule)) {
        guardedNames.add(name);
      }
    }
  }

  const candidates = benchmarks.filter(
    (bench) => shouldGuardBenchmark(bench.name, bench) && !guardedNames.has(bench.name),
  );

  const grouped = new Map();
  for (const bench of candidates) {
    const pattern = autoPatternFor(bench.name);
    const key = ruleKey(pattern);
    if (!grouped.has(key)) {
      grouped.set(key, { rule: pattern, names: [] });
    }
    grouped.get(key).names.push(bench.name);
    guardedNames.add(bench.name);
  }

  for (const { rule, names } of grouped.values()) {
    if (kept.some((existing) => ruleKey(existing) === ruleKey(rule))) {
      continue;
    }
    kept.push({ ...rule });
    added.push({ rule: ruleKey(rule), names });
  }

  config.thresholds = kept;
  return { removed, added, totalReports };
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

function roundUpCleanPerLine(msPerLine) {
  if (msPerLine >= 0.1) {
    return Math.ceil(msPerLine * 100) / 100;
  }
  if (msPerLine >= 0.01) {
    return Math.ceil(msPerLine * 200) / 200;
  }
  return Math.ceil(msPerLine * 1000) / 1000;
}

function outlierKey(sample) {
  return `${sample.report}::${sample.name}`;
}

function verifyReports(reports, config, outlierKeys) {
  const failures = [];
  const outlierWarnings = [];

  for (const report of reports) {
    for (const bench of collectBenchmarks(report)) {
      const rule = (config.thresholds ?? []).find((entry) => matchesRule(bench.name, entry));
      if (rule && bench.p995 > rule.maxMs) {
        const key = `${report.__sourcePath}::${bench.name}`;
        const entry = {
          report: report.__sourcePath,
          name: bench.name,
          p995: bench.p995,
          limit: rule.maxMs,
        };
        if (outlierKeys.has(key)) {
          outlierWarnings.push(entry);
        } else {
          failures.push(entry);
        }
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
          const key = `${report.__sourcePath}::${bench.name}`;
          const entry = {
            report: report.__sourcePath,
            name: bench.name,
            p995: msPerLine,
            limit: tokenizeDerived.maxMsPerLine,
            unit: "ms/line",
          };
          if (outlierKeys.has(key)) {
            outlierWarnings.push(entry);
          } else {
            failures.push(entry);
          }
        }
      }
    }
  }
  return { failures, outlierWarnings };
}

function main() {
  const { reportPaths, conservative } = parseArgs(process.argv);
  const reports = reportPaths.map((path) => {
    const report = loadJson(path);
    report.__sourcePath = path;
    return report;
  });
  const config = loadJson(thresholdsPath);
  const benchmarkMap = mergeBenchmarkReports(reports);
  const benchmarks = [...benchmarkMap.values()];
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
    `Aggregation: ${conservative ? "conservative (global max p995)" : "robust (IQR outlier dismissal + max of retained)"}`,
  );
  console.log(
    `Formula: baseline + max(${formula.absoluteFloorMs} ms, ${formula.relativeMargin} × baseline, statisticalMarginMs)`,
  );
  console.log("Rounding: ×10 (≥100 ms), ×5 (≥10 ms), even (≥2 ms), min 2 ms");
  console.log("");

  const sync = syncThresholdRules(config, benchmarkMap, reports.length);
  if (sync.removed.length > 0) {
    console.log(`Removed ${sync.removed.length} stale rule(s):`);
    for (const key of sync.removed) {
      console.log(`  - ${key}`);
    }
    console.log("");
  }
  if (sync.added.length > 0) {
    console.log(`Added ${sync.added.length} new rule(s):`);
    for (const entry of sync.added) {
      console.log(`  - ${entry.rule} (${entry.names.length} benchmark(s))`);
    }
    console.log("");
  }

  const outlierKeys = new Set();
  let updatedRules = 0;

  for (const rule of config.thresholds ?? []) {
    const samples = collectRuleSamples(reports, rule);
    if (samples.length === 0) {
      console.warn(`[skip] No report entry for rule: ${ruleKey(rule)}`);
      continue;
    }

    const aggregate = aggregateSamples(samples, { conservative });
    for (const outlier of aggregate.outliers) {
      outlierKeys.add(outlierKey(outlier));
    }

    const rawMaxMs = computeThresholdMs(
      aggregate.baselineMs,
      aggregate.statisticalMarginMs,
      formula,
    );
    const maxMs = roundUpClean(rawMaxMs);

    rule.baselineMs = Math.ceil(aggregate.baselineMs * 1000) / 1000;
    rule.statisticalMarginMs = Math.ceil(aggregate.statisticalMarginMs * 10000) / 10000;
    rule.rawMaxMs = Math.ceil(aggregate.rawMax * 1000) / 1000;
    rule.maxMs = maxMs;
    updatedRules += 1;

    const rounded = maxMs !== Math.ceil(rawMaxMs) ? ` (raw ${rawMaxMs.toFixed(2)} → ${maxMs})` : "";
    const outlierNote =
      aggregate.outliers.length > 0
        ? `, dismissed ${aggregate.outliers.length} outlier(s), raw max ${aggregate.rawMax.toFixed(1)} ms`
        : "";
    console.log(
      `[update] ${ruleKey(rule)}: baseline=${rule.baselineMs}ms → maxMs=${maxMs}ms${rounded}${outlierNote}`,
    );
    console.log(`         ${aggregate.method}`);
  }

  const tokenizeSamples = [];
  for (const report of reports) {
    for (const bench of collectBenchmarks(report)) {
      const lineCount = parseLineCount(bench.name);
      if (
        !bench.name.startsWith("tokenize ") ||
        !lineCount ||
        lineCount < (derivedDefaults.minLines ?? 500)
      ) {
        continue;
      }
      tokenizeSamples.push({
        name: bench.name,
        p995: bench.p995 / lineCount,
        moe: bench.moe / lineCount,
        report: report.__sourcePath,
      });
    }
  }

  if (tokenizeSamples.length > 0) {
    const aggregate = aggregateSamples(tokenizeSamples, { conservative });
    for (const outlier of aggregate.outliers) {
      outlierKeys.add(outlierKey(outlier));
    }

    const rawMaxMsPerLine = computeThresholdPerLine(
      aggregate.baselineMs,
      aggregate.statisticalMarginMs,
      formula,
      derivedDefaults,
    );
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
    const outlierNote =
      aggregate.outliers.length > 0 ? `, dismissed ${aggregate.outliers.length} outlier(s)` : "";
    console.log(`[update] derived.tokenize.maxMsPerLine=${maxMsPerLine}${rounded}${outlierNote}`);
  }

  config.metric = config.metric ?? "p995";
  config.formula = formula;
  config.aggregation = {
    mode: conservative ? "max" : "robust",
    description: conservative
      ? "baseline = global max p995 across reports"
      : "baseline = max p995 after Tukey IQR outlier dismissal",
  };

  writeFileSync(thresholdsPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("");
  console.log(`Wrote ${updatedRules} threshold rule(s) to ${thresholdsPath}`);

  const { failures, outlierWarnings } = verifyReports(reports, config, outlierKeys);

  if (outlierWarnings.length > 0) {
    console.log("");
    console.log(
      `${outlierWarnings.length} dismissed outlier(s) exceed the new threshold (expected):`,
    );
    for (const warning of outlierWarnings) {
      const unit = warning.unit ?? "ms";
      console.log(
        `  - [outlier] ${warning.name}: ${warning.p995.toFixed(3)} ${unit} > ${warning.limit} ${unit}`,
      );
    }
  }

  if (failures.length === 0) {
    console.log(`All non-outlier measurements from ${reports.length} reports pass.`);
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
