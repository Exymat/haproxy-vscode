#!/usr/bin/env node
/**
 * Run `haproxy -c` on each .cfg and compare first error line with extension diagnostics.
 * Also flags extension errors on files haproxy accepts, and haproxy errors with no extension match.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const schemaPath = join(extensionRoot, "schemas", "haproxy-3.2.schema.json");
const mockVscodePath = join(__dirname, "mock-vscode.cjs");
const defaultConfDir = resolve(extensionRoot, "..", "haproxy_git", "haproxy-3.2", "tests", "conf");

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

const HAPROXY_CMD = process.env.HAPROXY_CMD ?? "wsl haproxy";
const confDir = resolve(process.argv[2] ?? defaultConfDir);
const reportPath = process.argv[3] ?? join(__dirname, "compare-haproxy-c-report.json");

const LINE_RE = /:(\d+)\]/g;
const PARSING_RE = /parsing \[([^\]]+):(\d+)\]/;

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

function runHaproxyCheck(filePath) {
  const cfgPath = process.platform === "win32" ? wslPath(filePath) : filePath;
  try {
    const raw = execSync(`${HAPROXY_CMD} -c -f ${JSON.stringify(cfgPath)} 2>&1`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, lines: [], raw };
  } catch (error) {
    const raw = (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? "");
    if (/Configuration file has no error/i.test(raw) && !/\[ALERT\]/i.test(raw)) {
      return { ok: true, lines: [], raw };
    }
    const lines = new Set();
    let m;
    const parsing = PARSING_RE.exec(raw);
    if (parsing) {
      lines.add(Number.parseInt(parsing[2], 10));
    }
    LINE_RE.lastIndex = 0;
    while ((m = LINE_RE.exec(raw)) !== null) {
      lines.add(Number.parseInt(m[1], 10));
    }
    return { ok: false, lines: [...lines].sort((a, b) => a - b), raw };
  }
}

function extensionErrorLines(filePath, content) {
  const doc = createDocument(content, `file://${filePath}`);
  const diags = computeDiagnostics(doc, schema).filter((d) => isErrorSeverity(d.severity));
  return [...new Set(diags.map((d) => d.range.start.line + 1))].sort((a, b) => a - b);
}

function extensionDiagnosticsDetail(filePath, content) {
  const doc = createDocument(content, `file://${filePath}`);
  return computeDiagnostics(doc, schema)
    .filter((d) => isErrorSeverity(d.severity))
    .map((d) => ({
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
  const extDetail = extensionDiagnosticsDetail(file, content);

  const entry = {
    file: name,
    haproxyOk: haproxy.ok,
    haproxyLines: haproxy.lines,
    extensionLines: extLines,
    extensionCount: extDetail.length,
    issues: [],
  };

  if (haproxy.ok && extLines.length > 0) {
    entry.issues.push({
      kind: "extension-only",
      message: `haproxy OK but extension reports ${extLines.length} error line(s)`,
      lines: extLines,
    });
  }

  if (!haproxy.ok) {
    const firstHa = haproxy.lines[0];
    const skippable =
      /unable to stat SSL|Couldn't open the ca-file|Couldn't open the crt-file|lua-load|lua_load|failed to load lua|Cannot load lua/i.test(
        haproxy.raw,
      );
    if (firstHa && !extLines.includes(firstHa) && !skippable) {
      entry.issues.push({
        kind: "haproxy-missed",
        message: `haproxy first error line ${firstHa} has no extension error`,
        haproxyRaw: haproxy.raw.slice(0, 500),
      });
    }
  }

  if (!haproxy.ok && extLines.length === 0) {
    const skippable =
      /unable to stat SSL|Couldn't open the ca-file|Couldn't open the crt-file|lua-load|lua_load|failed to load lua|Cannot load lua/i.test(
        haproxy.raw,
      );
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
    if (r.extensionCount && issue.kind === "extension-only") {
      const detail = extensionDiagnosticsDetail(
        join(confDir, r.file),
        readFileSync(join(confDir, r.file), "utf-8"),
      );
      for (const d of detail.slice(0, 8)) {
        console.log(`    L${d.line} [${d.code}] ${d.message}`);
      }
      if (detail.length > 8) {
        console.log(`    ... +${detail.length - 8} more`);
      }
    }
  }
}

process.exit(drift.length > 0 ? 1 : 0);
