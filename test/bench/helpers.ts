import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createDocument, type MockTextDocument } from "../helpers/document";

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function summarizeSamples(samplesMs: number[]): {
  count: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
} {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    mean: total / sorted.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export async function measureAsync(
  fn: () => void | Promise<void>,
  options: { warmup?: number; iterations?: number } = {},
): Promise<ReturnType<typeof summarizeSamples>> {
  const warmup = options.warmup ?? 3;
  const iterations = options.iterations ?? 20;
  for (let i = 0; i < warmup; i += 1) {
    await fn();
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return summarizeSamples(samples);
}

const schemaBundleCache = new Map<string, unknown>();

export function clearBenchSchemaCache(): void {
  schemaBundleCache.clear();
}

export function loadSchemaFileWarm<T>(key: string, filePath: string): T {
  if (!schemaBundleCache.has(key)) {
    schemaBundleCache.set(key, JSON.parse(readFileSync(filePath, "utf-8")) as T);
  }
  return schemaBundleCache.get(key) as T;
}

export interface PerfReportEntry {
  name: string;
  unit: "ms";
  stats: ReturnType<typeof summarizeSamples>;
  metadata?: Record<string, unknown>;
}

export interface PerfReport {
  generatedAt: string;
  platform: string;
  nodeVersion: string;
  benchmarks: PerfReportEntry[];
}

export function writePerfReport(reportPath: string, benchmarks: PerfReportEntry[]): void {
  const report: PerfReport = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    benchmarks,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export function benchFixturePath(relativePath: string): string {
  return join(__dirname, "fixtures", relativePath);
}

export function integrationFixturePath(relativePath: string): string {
  return join(__dirname, "..", "integration", "fixtures", relativePath);
}

export function readFixture(relativePath: string, from: "bench" | "integration" = "bench"): string {
  const filePath =
    from === "bench" ? benchFixturePath(relativePath) : integrationFixturePath(relativePath);
  return readFileSync(filePath, "utf-8");
}

export const extensionRoot = join(__dirname, "..", "..");

export interface BenchFixture {
  name: string;
  file: string;
  from: "bench" | "integration";
  workload: "baseline" | "valid-large" | "mixed-large";
  scenarios: Array<"tokenize" | "format" | "diagnostics" | "completion" | "navigation">;
}

export const BENCH_FIXTURES: BenchFixture[] = [
  {
    name: "sample.cfg",
    file: "sample.cfg",
    from: "integration",
    workload: "baseline",
    scenarios: ["tokenize", "format", "diagnostics"],
  },
  {
    name: "diagnostics-long.cfg",
    file: "diagnostics-long.cfg",
    from: "integration",
    workload: "baseline",
    scenarios: ["tokenize", "format", "diagnostics"],
  },
  {
    name: "large-valid.cfg",
    file: "large-valid.cfg",
    from: "bench",
    workload: "valid-large",
    scenarios: ["tokenize", "format", "diagnostics", "completion", "navigation"],
  },
  {
    name: "large-mixed.cfg",
    file: "large-mixed.cfg",
    from: "bench",
    workload: "mixed-large",
    scenarios: ["tokenize", "format", "diagnostics"],
  },
];

export function fixtureLineCount(fixture: BenchFixture): number {
  return readFixture(fixture.file, fixture.from).split(/\r?\n/).length;
}

export function fixturesForScenario(
  scenario: "tokenize" | "format" | "diagnostics" | "completion" | "navigation",
): BenchFixture[] {
  return BENCH_FIXTURES.filter((fixture) => fixture.scenarios.includes(scenario));
}

export function tokenizeRateLabel(totalMs: number, lineCount: number): string {
  const msPerLine = lineCount > 0 ? totalMs / lineCount : 0;
  const linesPerSec = totalMs > 0 ? (lineCount / totalMs) * 1000 : 0;
  return `${msPerLine.toFixed(3)} ms/line, ${linesPerSec.toFixed(0)} lines/s`;
}

export function createEditedDocument(
  baseContent: string,
  editLine: number,
  newLineText: string,
): MockTextDocument {
  const lines = baseContent.split(/\r?\n/);
  if (editLine < 0 || editLine >= lines.length) {
    throw new Error(`edit line ${editLine} out of range (${lines.length} lines)`);
  }
  lines[editLine] = newLineText;
  return createDocument(lines.join("\n"));
}

export function findLineContaining(content: string, needle: string): number {
  const index = content.split(/\r?\n/).findIndex((line) => line.includes(needle));
  if (index < 0) {
    throw new Error(`Expected to find line containing "${needle}" in benchmark fixture`);
  }
  return index;
}

export const BENCH_VERSIONS = ["2.6", "3.2", "3.4"] as const;

/** Line cap for symbol-index features on 24k-line bench fixtures (matches extension default intent). */
export const BENCH_LARGE_MAX_LINES = 26_000;
