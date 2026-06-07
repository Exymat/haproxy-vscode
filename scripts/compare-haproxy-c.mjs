#!/usr/bin/env node
/**
 * Run `haproxy -c` on each .cfg and compare first error line with extension diagnostics.
 * Also flags extension errors on files haproxy accepts, and haproxy errors with no extension match.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const mockVscodePath = join(__dirname, "mock-vscode.cjs");

function parseArgs(argv) {
  const positional = [];
  let version = process.env.HAPROXY_VERSION ?? "3.2";
  let runtime = process.env.HAPROXY_RUNTIME ?? "local";
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === "--version") {
      version = argv[idx + 1] ?? version;
      idx += 1;
      continue;
    }
    if (arg === "--runtime") {
      runtime = argv[idx + 1] ?? runtime;
      idx += 1;
      continue;
    }
    positional.push(arg);
  }
  return { version, runtime, positional };
}

const { version, runtime, positional } = parseArgs(process.argv.slice(2));
const schemaPath = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
const defaultConfDir = resolve(
  extensionRoot,
  "..",
  "haproxy_git",
  `haproxy-${version}`,
  "tests",
  "conf",
);

const require = createRequire(import.meta.url);
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "vscode") {
    return mockVscodePath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { computeDiagnostics } = require(join(extensionRoot, "out", "diagnostics.js"));
const { DiagnosticSeverity } = require(mockVscodePath);
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

function isErrorSeverity(severity) {
  return severity === DiagnosticSeverity.Error;
}

function isExtensionSeverity(severity) {
  return severity === DiagnosticSeverity.Error || severity === DiagnosticSeverity.Warning;
}

const HAPROXY_CMD = process.env.HAPROXY_CMD ?? "wsl haproxy";
const HAPROXY_DOCKER_IMAGE = process.env.HAPROXY_DOCKER_IMAGE ?? `haproxy:${version}-trixie`;
const HAPROXY_DOCKER_CMD =
  process.env.HAPROXY_DOCKER_CMD ?? (process.platform === "win32" ? "wsl docker" : "docker");
const confDir = resolve(positional[0] ?? defaultConfDir);
const reportPath = positional[1] ?? join(__dirname, `compare-haproxy-c-${version}-report.json`);

const LINE_RE = /:(\d+)\]/g;
const PARSING_RE = /parsing \[([^\]]+):(\d+)\]/;
const ALERT_RE = /\[ALERT\]/i;
const SKIPPABLE_HAPROXY_FAILURE_RE =
  /unable to stat SSL|Couldn't open the ca-file|Couldn't open the crt-file|lua-load|lua_load|failed to load lua|Cannot load lua|error in Lua file|external-check|ext-check/i;
const DOCKER_INFRA_FAILURE_RE =
  /invalid volume specification|Cannot connect to the Docker daemon|error during connect|is the docker daemon running|docker: command not found/i;

/** HAProxy upstream configs that intentionally exercise sample-expression validation. */
const SAMPLE_EXPRESSION_TEST_FILES = new Set([
  "test-acl-args.cfg",
  "test-sample-fetch-args.cfg",
  "test-sample-fetch-conv.cfg",
]);

/** Extension diagnostics excluded from matrix parity (stricter than haproxy -c by design). */
const MATRIX_EXCLUDED_DIAG_CODES = new Set([
  "deprecated-sample",
  "sample-unknown-fetch",
  "sample-syntax",
  "sample-fetch-args",
  "sample-unknown-converter",
  "sample-converter-cast",
  "sample-converter-args",
  "wrong-context",
]);

function isExcludedExtensionDiagnostic(diag) {
  return MATRIX_EXCLUDED_DIAG_CODES.has(diag.code ?? "");
}

function isInfrastructureFailure(haproxy) {
  if (haproxy.spawnError) {
    return true;
  }
  if (DOCKER_INFRA_FAILURE_RE.test(haproxy.raw)) {
    return true;
  }
  if (!haproxy.ok && haproxy.lines.length === 0 && !haproxy.raw.trim()) {
    return true;
  }
  return false;
}

function comparableExtensionDiagnostics(filePath, content, { errorsOnly = false } = {}) {
  const doc = createDocument(content, `file://${filePath}`);
  const severityFilter = errorsOnly ? isErrorSeverity : isExtensionSeverity;
  return computeDiagnostics(doc, schema)
    .filter((d) => severityFilter(d.severity))
    .filter((d) => !isExcludedExtensionDiagnostic(d));
}

function extractHaproxyErrorLines(raw) {
  const lines = new Set();
  const parsing = PARSING_RE.exec(raw);
  if (parsing) {
    lines.add(Number.parseInt(parsing[2], 10));
  }
  LINE_RE.lastIndex = 0;
  let m;
  while ((m = LINE_RE.exec(raw)) !== null) {
    lines.add(Number.parseInt(m[1], 10));
  }
  return [...lines].sort((a, b) => a - b);
}

function interpretHaproxyCheck(status, raw, spawnError) {
  if (spawnError) {
    return { ok: false, lines: [], raw, spawnError: true };
  }
  if (/Configuration file has no error/i.test(raw)) {
    return { ok: true, lines: [], raw };
  }
  if (status === 0 && !ALERT_RE.test(raw)) {
    return { ok: true, lines: [], raw };
  }
  return { ok: false, lines: extractHaproxyErrorLines(raw), raw };
}

function collectCfgFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectCfgFiles(full));
    } else if (entry.endsWith(".cfg")) {
      files.push(full);
    }
  }
  return files.sort();
}

function createDocument(content, uri) {
  const lines = content.split(/\r?\n/);
  return {
    uri,
    lineCount: lines.length,
    lineAt(lineNo) {
      return { text: lines[lineNo] ?? "" };
    },
    getText() {
      return content;
    },
  };
}

function wslPath(winPath) {
  const drive = winPath[0].toLowerCase();
  return `/mnt/${drive}/${winPath.slice(3).replace(/\\/g, "/")}`;
}

function dockerMountPath(hostDir, dockerCmd) {
  if (process.platform !== "win32") {
    return hostDir;
  }
  if (dockerCmd[0]?.toLowerCase() === "wsl") {
    return wslPath(hostDir);
  }
  // Docker Desktop on Windows accepts forward slashes in volume sources.
  return hostDir.replace(/\\/g, "/");
}

function runHaproxyCheck(filePath) {
  if (runtime === "docker") {
    const hostDir = dirname(filePath);
    const fileName = basename(filePath);
    const mountPath = "/work";
    const dockerCmd = HAPROXY_DOCKER_CMD.trim().split(/\s+/).filter(Boolean);
    const hostMountDir = dockerMountPath(hostDir, dockerCmd);
    const args = [
      "run",
      "--rm",
      "-v",
      `${hostMountDir}:${mountPath}:ro`,
      HAPROXY_DOCKER_IMAGE,
      "haproxy",
      "-c",
      "-f",
      `${mountPath}/${fileName}`,
    ];
    const res = spawnSync(dockerCmd[0], [...dockerCmd.slice(1), ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const raw = `${res.stdout ?? ""}${res.stderr ?? ""}${res.error?.message ?? ""}`.trim();
    return interpretHaproxyCheck(res.status, raw, Boolean(res.error));
  }

  const cfgPath = process.platform === "win32" ? wslPath(filePath) : filePath;
  try {
    const raw = execSync(`${HAPROXY_CMD} -c -f ${JSON.stringify(cfgPath)} 2>&1`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return interpretHaproxyCheck(0, raw, false);
  } catch (error) {
    const raw = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`.trim();
    const status = typeof error.status === "number" ? error.status : 1;
    return interpretHaproxyCheck(status, raw, false);
  }
}

function extensionErrorLines(filePath, content) {
  const diags = comparableExtensionDiagnostics(filePath, content, { errorsOnly: true });
  return [...new Set(diags.map((d) => d.range.start.line + 1))].sort((a, b) => a - b);
}

function extensionDiagnosticLines(filePath, content) {
  const diags = comparableExtensionDiagnostics(filePath, content);
  return [...new Set(diags.map((d) => d.range.start.line + 1))].sort((a, b) => a - b);
}

function extensionDiagnosticsDetail(filePath, content, { includeWarnings = false } = {}) {
  const diags = comparableExtensionDiagnostics(filePath, content, { errorsOnly: !includeWarnings });
  return diags.map((d) => ({
    line: d.range.start.line + 1,
    code: d.code ?? "unknown",
    message: d.message,
  }));
}

const files = collectCfgFiles(confDir);
const report = [];

for (const file of files) {
  const content = readFileSync(file, "utf-8");
  const name = basename(file);
  const haproxy = runHaproxyCheck(file);
  const extLines = extensionErrorLines(file, content);
  const extDiagLines = extensionDiagnosticLines(file, content);
  const extDetail = extensionDiagnosticsDetail(file, content);

  const entry = {
    file: name,
    haproxyOk: haproxy.ok,
    haproxyLines: haproxy.lines,
    extensionLines: extLines,
    extensionDiagnosticLines: extDiagLines,
    extensionCount: extDetail.length,
    issues: [],
  };

  if (haproxy.ok && extDiagLines.length > 0) {
    entry.issues.push({
      kind: "extension-only",
      message: `haproxy OK but extension reports ${extDiagLines.length} diagnostic line(s)`,
      lines: extDiagLines,
    });
  }

  if (!haproxy.ok && extDiagLines.length > 0) {
    const haproxyLineSet = new Set(haproxy.lines);
    const orphanLines = extDiagLines.filter((lineNo) => !haproxyLineSet.has(lineNo));
    if (orphanLines.length > 0) {
      entry.issues.push({
        kind: "extension-only-lines",
        message: `extension reports diagnostics on ${orphanLines.length} line(s) haproxy accepts`,
        lines: orphanLines,
      });
    }
  }

  const sampleExpressionTest = SAMPLE_EXPRESSION_TEST_FILES.has(name);

  if (!haproxy.ok && !sampleExpressionTest) {
    const firstHa = haproxy.lines[0];
    const skippable = SKIPPABLE_HAPROXY_FAILURE_RE.test(haproxy.raw);
    if (firstHa && !extLines.includes(firstHa) && !skippable) {
      entry.issues.push({
        kind: "haproxy-missed",
        message: `haproxy first error line ${firstHa} has no extension error`,
        haproxyRaw: haproxy.raw.slice(0, 500),
      });
    }
  }

  if (!haproxy.ok && extLines.length === 0 && !sampleExpressionTest) {
    const skippable =
      SKIPPABLE_HAPROXY_FAILURE_RE.test(haproxy.raw) || isInfrastructureFailure(haproxy);
    if (!skippable) {
      entry.issues.push({
        kind: "no-extension-errors",
        message: "haproxy failed but extension reports no errors",
        haproxyRaw: haproxy.raw.slice(0, 500),
      });
    }
  }

  report.push(entry);
}

writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

const drift = report.filter((r) => r.issues.length > 0);
console.log(`Compared ${files.length} files under ${confDir}`);
console.log(`Version: ${version}`);
console.log(`Runtime: ${runtime}`);
console.log(`Drift: ${drift.length} file(s)`);
for (const r of drift) {
  console.log(`\n## ${r.file}`);
  for (const issue of r.issues) {
    console.log(`  [${issue.kind}] ${issue.message}`);
    if (issue.lines) {
      console.log(`    extension lines: ${issue.lines.join(", ")}`);
    }
    if (r.haproxyLines.length) {
      console.log(`    haproxy lines: ${r.haproxyLines.join(", ")}`);
    }
    if (issue.haproxyRaw) {
      console.log(
        `    haproxy: ${issue.haproxyRaw.split("\n").find((l) => l.includes("ALERT") || l.includes("parsing")) ?? ""}`,
      );
    }
    if (issue.kind === "extension-only" || issue.kind === "extension-only-lines") {
      const detail = extensionDiagnosticsDetail(
        join(confDir, r.file),
        readFileSync(join(confDir, r.file), "utf-8"),
        { includeWarnings: true },
      );
      const issueLineSet = issue.lines ? new Set(issue.lines) : null;
      const shown = issueLineSet ? detail.filter((d) => issueLineSet.has(d.line)) : detail;
      for (const d of shown.slice(0, 8)) {
        console.log(`    L${d.line} [${d.code}] ${d.message}`);
      }
      if (shown.length > 8) {
        console.log(`    ... +${shown.length - 8} more`);
      }
    }
  }
}

process.exit(drift.length > 0 ? 1 : 0);
