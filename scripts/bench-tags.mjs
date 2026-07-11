#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const testRoot = join(repoRoot, "test");
const fixturesRoot = join(testRoot, "integration", "fixtures");
const reportsRoot = join(repoRoot, "scripts", "reports", "tag-bench");
const worktreesRoot = join(repoRoot, ".tmp-tag-bench", "worktrees");
const extensionTestsPath = join(__dirname, "tag-bench", "extension-suite.cjs");
const workspaceFolder = fixturesRoot;
const nodeModulesPath = join(repoRoot, "node_modules");

function commandName(base) {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf-8",
    stdio: options.capture ? "pipe" : "inherit",
    shell:
      options.shell ?? (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")),
  });

  if (result.error) {
    throw result.error;
  }

  if (options.capture) {
    return result;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`,
    );
  }

  return result;
}

function parseArgs(argv) {
  /** @type {{ tags?: string[], limit?: number }} */
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tags") {
      options.tags = (argv[i + 1] ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(argv[i + 1] ?? "0", 10);
      i += 1;
    }
  }
  return options;
}

function git(args, capture = false) {
  return run("git", args, { capture, cwd: repoRoot });
}

function listTags() {
  const result = git(["tag", "--sort=creatordate"], true);
  if (result.status !== 0) {
    throw new Error(result.stderr || "unable to list tags");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sanitizeTag(tag) {
  return tag.replace(/[^A-Za-z0-9._-]/g, "_");
}

function ensureCleanDir(dirPath) {
  const resolved = resolve(dirPath);
  const root = resolve(join(repoRoot, ".tmp-tag-bench"));
  if (!resolved.startsWith(root)) {
    throw new Error(`refusing to remove non-benchmark path: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
  mkdirSync(resolved, { recursive: true });
}

function ensureSharedNodeModules(worktreePath) {
  const target = join(worktreePath, "node_modules");
  if (existsSync(target)) {
    return;
  }
  symlinkSync(nodeModulesPath, target, "junction");
}

function patchLegacyTsconfigForNodeTypes(worktreePath) {
  const tsconfigPath = join(worktreePath, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return false;
  }

  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
  const compilerOptions = (tsconfig.compilerOptions ??= {});
  const types = new Set(Array.isArray(compilerOptions.types) ? compilerOptions.types : []);
  if (types.has("node")) {
    return false;
  }

  types.add("node");
  compilerOptions.types = [...types];
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
  return true;
}

function ensureLocalNodeModules(worktreePath) {
  const target = join(worktreePath, "node_modules");
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      rmSync(target, { recursive: true, force: true });
    } else {
      return;
    }
  }
  run(commandName("npm"), ["install"], { cwd: worktreePath });
}

function ensureWorktree(tag) {
  const worktreePath = join(worktreesRoot, sanitizeTag(tag));
  if (existsSync(join(worktreePath, ".git"))) {
    return worktreePath;
  }

  mkdirSync(worktreesRoot, { recursive: true });
  const add = git(["worktree", "add", "--force", "--detach", worktreePath, tag], true);
  if (add.status !== 0) {
    throw new Error(add.stderr || `unable to create worktree for ${tag}`);
  }
  return worktreePath;
}

function compileWorktree(worktreePath) {
  ensureSharedNodeModules(worktreePath);
  try {
    run(commandName("npm"), ["run", "compile"], { cwd: worktreePath });
  } catch {
    if (patchLegacyTsconfigForNodeTypes(worktreePath)) {
      run(commandName("npm"), ["run", "compile"], { cwd: worktreePath });
      return;
    }

    ensureLocalNodeModules(worktreePath);
    run(commandName("npm"), ["run", "compile"], { cwd: worktreePath });
  }
}

function readPackageJson(worktreePath) {
  return JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf-8"));
}

function readTagDate(tag) {
  const result = git(["log", "-1", "--format=%cI", tag], true);
  if (result.status !== 0) {
    throw new Error(result.stderr || `unable to read date for ${tag}`);
  }
  return result.stdout.trim();
}

function readTagCommit(tag) {
  const result = git(["rev-list", "-n", "1", tag], true);
  if (result.status !== 0) {
    throw new Error(result.stderr || `unable to read commit for ${tag}`);
  }
  return result.stdout.trim();
}

async function runBenchSuite({ tag, worktreePath, reportPath }) {
  const savedEnv = {
    HAPROXY_TAG_BENCH_EXTENSION_PATH: process.env.HAPROXY_TAG_BENCH_EXTENSION_PATH,
    HAPROXY_TAG_BENCH_TESTS_PATH: process.env.HAPROXY_TAG_BENCH_TESTS_PATH,
    HAPROXY_TAG_BENCH_WORKSPACE: process.env.HAPROXY_TAG_BENCH_WORKSPACE,
    HAPROXY_TAG_BENCH_REPORT_PATH: process.env.HAPROXY_TAG_BENCH_REPORT_PATH,
    HAPROXY_TAG_BENCH_TEST_ROOT: process.env.HAPROXY_TAG_BENCH_TEST_ROOT,
    HAPROXY_TAG_BENCH_VERSION: process.env.HAPROXY_TAG_BENCH_VERSION,
    HAPROXY_TAG_BENCH_TAG: process.env.HAPROXY_TAG_BENCH_TAG,
  };

  process.env.HAPROXY_TAG_BENCH_EXTENSION_PATH = worktreePath;
  process.env.HAPROXY_TAG_BENCH_TESTS_PATH = extensionTestsPath;
  process.env.HAPROXY_TAG_BENCH_WORKSPACE = workspaceFolder;
  process.env.HAPROXY_TAG_BENCH_REPORT_PATH = reportPath;
  process.env.HAPROXY_TAG_BENCH_TEST_ROOT = testRoot;
  process.env.HAPROXY_TAG_BENCH_VERSION = "3.2";
  process.env.HAPROXY_TAG_BENCH_TAG = tag;

  try {
    await runTests({
      extensionDevelopmentPath: worktreePath,
      extensionTestsPath,
      launchArgs: [workspaceFolder, "--disable-extensions"],
    });
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function collectScenarios(allRuns) {
  const scenarios = new Set();
  for (const runResult of allRuns) {
    for (const benchmark of runResult.benchmarks ?? []) {
      scenarios.add(benchmark.label);
    }
  }
  return [...scenarios].sort();
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildMarkdownReport(allRuns) {
  const scenarios = collectScenarios(allRuns);
  const lines = [
    "# Tag Benchmark Report",
    "",
    "| Tag | Date | Scenario | Status | Mean (ms) | P95 (ms) |",
    "| --- | --- | --- | --- | ---: | ---: |",
  ];

  for (const runResult of allRuns) {
    for (const scenario of scenarios) {
      const benchmark = (runResult.benchmarks ?? []).find((entry) => entry.label === scenario);
      lines.push(
        `| ${runResult.tag} | ${runResult.date.slice(0, 10)} | ${scenario} | ${benchmark?.status ?? "missing"} | ${benchmark?.stats?.mean?.toFixed?.(2) ?? ""} | ${benchmark?.stats?.p95?.toFixed?.(2) ?? ""} |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildCsvReport(allRuns) {
  const lines = ["tag,date,commit,scenario,status,mean_ms,p95_ms,reason"];
  for (const runResult of allRuns) {
    for (const benchmark of runResult.benchmarks ?? []) {
      lines.push(
        [
          runResult.tag,
          runResult.date,
          runResult.commit,
          benchmark.label,
          benchmark.status,
          benchmark.stats?.mean?.toFixed?.(4) ?? "",
          benchmark.stats?.p95?.toFixed?.(4) ?? "",
          benchmark.reason ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildHtmlReport(allRuns) {
  const scenarios = collectScenarios(allRuns);
  const payload = JSON.stringify(allRuns);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>HAProxy VS Code Tag Bench</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1, h2 { margin: 0 0 12px; }
    .chart { margin: 24px 0 40px; }
    svg { width: 100%; height: 240px; border: 1px solid #d0d7de; background: #fff; }
    table { border-collapse: collapse; width: 100%; margin-top: 24px; }
    th, td { border: 1px solid #d0d7de; padding: 6px 8px; text-align: left; }
    th { background: #f6f8fa; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>HAProxy VS Code Tag Bench</h1>
  <p class="muted">Metric shown in charts: mean latency in milliseconds. Missing or unavailable scenarios are omitted from lines.</p>
  <div id="charts"></div>
  <table id="summary">
    <thead>
      <tr><th>Tag</th><th>Date</th><th>Scenario</th><th>Status</th><th>Mean (ms)</th><th>P95 (ms)</th></tr>
    </thead>
    <tbody></tbody>
  </table>
  <script>
    const data = ${payload};
    const scenarios = ${JSON.stringify(scenarios)};
    const colors = ["#0969da", "#bf8700", "#1a7f37", "#8250df", "#cf222e", "#0a7ea4", "#9a6700"];
    const charts = document.getElementById("charts");
    const tbody = document.querySelector("#summary tbody");

    for (const run of data) {
      for (const bench of run.benchmarks || []) {
        const tr = document.createElement("tr");
        tr.innerHTML = "<td>" + run.tag + "</td><td>" + run.date.slice(0, 10) + "</td><td>" + bench.label + "</td><td>" + bench.status + "</td><td>" + (bench.stats ? bench.stats.mean.toFixed(2) : "") + "</td><td>" + (bench.stats ? bench.stats.p95.toFixed(2) : "") + "</td>";
        tbody.appendChild(tr);
      }
    }

    scenarios.forEach((scenario, index) => {
      const rows = data
        .map((run) => {
          const bench = (run.benchmarks || []).find((entry) => entry.label === scenario && entry.status === "ok");
          return bench ? { tag: run.tag, date: run.date, mean: bench.stats.mean } : null;
        })
        .filter(Boolean);

      const section = document.createElement("section");
      section.className = "chart";
      const title = document.createElement("h2");
      title.textContent = scenario;
      section.appendChild(title);

      if (rows.length < 2) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Not enough comparable points to draw a trend line.";
        section.appendChild(empty);
        charts.appendChild(section);
        return;
      }

      const values = rows.map((row) => row.mean);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const width = 960;
      const height = 240;
      const left = 48;
      const right = 16;
      const top = 16;
      const bottom = 32;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const span = Math.max(max - min, 1);

      const points = rows.map((row, rowIndex) => {
        const x = left + (plotWidth * rowIndex) / (rows.length - 1);
        const y = top + plotHeight - ((row.mean - min) / span) * plotHeight;
        return { ...row, x, y };
      });

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);

      const axis = document.createElementNS(svg.namespaceURI, "path");
      axis.setAttribute("d", "M " + left + " " + top + " V " + (height - bottom) + " H " + (width - right));
      axis.setAttribute("stroke", "#8c959f");
      axis.setAttribute("fill", "none");
      svg.appendChild(axis);

      const polyline = document.createElementNS(svg.namespaceURI, "polyline");
      polyline.setAttribute("points", points.map((point) => point.x + "," + point.y).join(" "));
      polyline.setAttribute("stroke", colors[index % colors.length]);
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke-width", "2");
      svg.appendChild(polyline);

      points.forEach((point) => {
        const circle = document.createElementNS(svg.namespaceURI, "circle");
        circle.setAttribute("cx", point.x);
        circle.setAttribute("cy", point.y);
        circle.setAttribute("r", "3.5");
        circle.setAttribute("fill", colors[index % colors.length]);
        svg.appendChild(circle);

        const label = document.createElementNS(svg.namespaceURI, "text");
        label.setAttribute("x", point.x);
        label.setAttribute("y", height - 10);
        label.setAttribute("font-size", "10");
        label.setAttribute("text-anchor", "middle");
        label.textContent = point.tag;
        svg.appendChild(label);
      });

      const topLabel = document.createElementNS(svg.namespaceURI, "text");
      topLabel.setAttribute("x", "8");
      topLabel.setAttribute("y", "18");
      topLabel.setAttribute("font-size", "10");
      topLabel.textContent = max.toFixed(2) + " ms";
      svg.appendChild(topLabel);

      const bottomLabel = document.createElementNS(svg.namespaceURI, "text");
      bottomLabel.setAttribute("x", "8");
      bottomLabel.setAttribute("y", height - bottom);
      bottomLabel.setAttribute("font-size", "10");
      bottomLabel.textContent = min.toFixed(2) + " ms";
      svg.appendChild(bottomLabel);

      section.appendChild(svg);
      charts.appendChild(section);
    });
  </script>
</body>
</html>
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tags = (options.tags?.length ? options.tags : listTags()).slice(
    options.limit ? -options.limit : undefined,
  );

  git(["worktree", "prune"]);
  ensureCleanDir(join(repoRoot, ".tmp-tag-bench"));
  mkdirSync(reportsRoot, { recursive: true });

  /** @type {Array<any>} */
  const allRuns = [];
  for (const tag of tags) {
    console.log(`\n=== Benchmarking tag ${tag} ===`);
    const worktreePath = ensureWorktree(tag);
    const reportPath = join(reportsRoot, `${sanitizeTag(tag)}.json`);
    const packageJson = readPackageJson(worktreePath);

    try {
      compileWorktree(worktreePath);
      await runBenchSuite({ tag, worktreePath, reportPath });
      const report = JSON.parse(readFileSync(reportPath, "utf-8"));
      allRuns.push({
        tag,
        date: readTagDate(tag),
        commit: readTagCommit(tag),
        packageVersion: packageJson.version,
        benchmarks: report.benchmarks ?? [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      allRuns.push({
        tag,
        date: readTagDate(tag),
        commit: readTagCommit(tag),
        packageVersion: packageJson.version,
        benchmarks: [],
        error: message,
      });
      console.error(`Tag ${tag} failed: ${message}`);
    }
  }

  const summaryPath = join(reportsRoot, "summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(allRuns, null, 2)}\n`);
  writeFileSync(join(reportsRoot, "summary.csv"), buildCsvReport(allRuns));
  writeFileSync(join(reportsRoot, "summary.md"), buildMarkdownReport(allRuns));
  writeFileSync(join(reportsRoot, "summary.html"), buildHtmlReport(allRuns));

  console.log(`\nWrote reports to ${reportsRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
