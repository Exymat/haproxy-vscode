#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const haproxyGitRoot = resolve(extensionRoot, "..", "haproxy_git");
const VERSIONS = ["2.6", "2.8", "3.0", "3.2", "3.4"];
const DEFAULT_VERSION = "3.2";
const mockVscodePath = join(__dirname, "mock-vscode.cjs");

const EXAMPLES_SKIP_BY_VERSION = {
  3.4: new Set(["keylog-test.cfg"]),
};

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

function loadSchema(version) {
  const path = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
  if (!existsSync(path)) {
    throw new Error(`missing schema: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadLanguageData(version) {
  const path = join(extensionRoot, "schemas", `haproxy-${version}.language.json`);
  if (!existsSync(path)) {
    throw new Error(`missing language data: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

const schemas = Object.fromEntries(VERSIONS.map((version) => [version, loadSchema(version)]));
const languageDataByVersion = Object.fromEntries(
  VERSIONS.map((version) => [version, loadLanguageData(version)]),
);

function diagnosticOptions(version = DEFAULT_VERSION, overrides = {}) {
  return {
    languageData: languageDataByVersion[version],
    deprecatedWarnings: true,
    ...overrides,
  };
}

function runDiagnostics(doc, schemaForCase, version = DEFAULT_VERSION, overrides = {}) {
  return computeDiagnostics(doc, schemaForCase, diagnosticOptions(version, overrides));
}

function createDocument(content, uri = "file:///test.cfg") {
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

const fixturesDir = join(extensionRoot, "test", "fixtures");
const hapeeAclSnippet = readFileSync(join(fixturesDir, "hapee-acl-snippet.cfg"), "utf-8");
const hapeeCfgPath = resolve(
  extensionRoot,
  "..",
  "HAPEE",
  "oci-integration-hub_priv",
  "haproxy.cfg",
);

if (!existsSync(haproxyGitRoot)) {
  console.log("test-diagnostics-upstream: skipped (haproxy_git not found)");
  process.exit(0);
}

function expectNoCode(
  content,
  name,
  code,
  schemaForCase = schemas[DEFAULT_VERSION],
  version = DEFAULT_VERSION,
) {
  const doc = createDocument(content);
  const diags = runDiagnostics(doc, schemaForCase, version).filter((d) => d.code === code);
  if (diags.length > 0) {
    throw new Error(
      `${name}: expected no '${code}' diagnostics, got ${diags.length}\n` +
        diags.map((d) => `  L${d.range.start.line + 1}: ${d.message}`).join("\n"),
    );
  }
}

let failed = false;
const ERROR_SEVERITY = 0;

function collectCfgFiles(dir) {
  const files = [];
  function collect(root) {
    for (const entry of readdirSync(root)) {
      const full = join(root, entry);
      if (statSync(full).isDirectory()) {
        collect(full);
      } else if (entry.endsWith(".cfg")) {
        files.push(full);
      }
    }
  }
  collect(dir);
  return files;
}

function assertNoErrorDiagnostics(
  label,
  dir,
  filterCodes,
  schemaForDir,
  version,
  skipFiles = new Set(),
) {
  const files = collectCfgFiles(dir).filter(
    (file) => !skipFiles.has(file.split(/[/\\]/).pop() ?? ""),
  );
  const blocked = filterCodes ? new Set(filterCodes) : null;
  const failures = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const diags = runDiagnostics(
      createDocument(content, `file://${file}`),
      schemaForDir,
      version,
    ).filter((diag) => diag.severity === ERROR_SEVERITY && (!blocked || blocked.has(diag.code)));
    if (diags.length > 0) {
      failures.push({ file, diags });
    }
  }
  if (failures.length > 0) {
    const lines = failures.map(({ file, diags }) => {
      const name = file.split(/[/\\]/).slice(-2).join("/");
      const sample = diags
        .slice(0, 5)
        .map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`)
        .join("\n");
      const more = diags.length > 5 ? `\n  ... +${diags.length - 5} more` : "";
      return `${name} (${diags.length}):\n${sample}${more}`;
    });
    throw new Error(
      `${failures.length}/${files.length} files have error diagnostics:\n${lines.join("\n")}`,
    );
  }
  return files.length;
}

function haproxyTreeDir(version, ...parts) {
  return join(haproxyGitRoot, `haproxy-${version}`, ...parts);
}

for (const version of VERSIONS) {
  const versionSchema = schemas[version];
  const confDir = haproxyTreeDir(version, "tests", "conf");
  process.stdout.write(`[${version}] all cfg in ${confDir} ... `);
  try {
    const count = assertNoErrorDiagnostics(
      "conf",
      confDir,
      ["unknown-keyword", "wrong-section"],
      versionSchema,
      version,
    );
    console.log(`ok (${count} files clean)`);
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }

  const examplesDir = haproxyTreeDir(version, "examples");
  const examplesSkip = EXAMPLES_SKIP_BY_VERSION[version] ?? new Set();
  const skipNote = examplesSkip.size > 0 ? `, skip ${[...examplesSkip].join(", ")}` : "";
  process.stdout.write(`[${version}] all cfg in ${examplesDir}${skipNote} ... `);
  try {
    const count = assertNoErrorDiagnostics(
      "examples",
      examplesDir,
      null,
      versionSchema,
      version,
      examplesSkip,
    );
    console.log(`ok (${count} files clean)`);
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }
}

const addressCodes = new Set([
  "invalid-address",
  "missing-port",
  "port-not-permitted",
  "port-range-not-permitted",
  "port-offset-not-permitted",
  "invalid-port",
]);
const portsExpectedLines = new Set([
  7, 8, 9, 11, 15, 16, 17, 20, 21, 22, 23, 24, 25, 30, 31, 32, 40, 48, 49, 55, 56, 57, 60, 63, 64,
  65, 72, 73, 74,
]);

function expectPortsAddressLines(confDir, versionSchema, version) {
  const portsPath = join(confDir, "ports.cfg");
  const portsContent = readFileSync(portsPath, "utf-8");
  const portsDiags = runDiagnostics(
    createDocument(portsContent, `file://${portsPath}`),
    versionSchema,
    version,
  ).filter((diag) => addressCodes.has(diag.code));
  const actualLines = new Set(portsDiags.map((diag) => diag.range.start.line + 1));
  const missing = [...portsExpectedLines].filter((line) => !actualLines.has(line));
  const extra = [...actualLines].filter((line) => !portsExpectedLines.has(line));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[${version}] ports.cfg mismatch: missing lines [${missing.join(", ")}], extra lines [${extra.join(", ")}]`,
    );
  }
}

for (const version of VERSIONS) {
  const confDir = haproxyTreeDir(version, "tests", "conf");
  process.stdout.write(`[${version}] ports.cfg address diagnostics ... `);
  try {
    expectPortsAddressLines(confDir, schemas[version], version);
    console.log(`ok (${portsExpectedLines.size} error lines)`);
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }
}

const sampleCodes = new Set([
  "sample-missing-fetch",
  "sample-unknown-fetch",
  "sample-fetch-args",
  "sample-unknown-converter",
  "sample-converter-args",
  "sample-converter-cast",
  "sample-syntax",
]);

function expectSampleLines(confDir, fileName, lineList, versionSchema, version) {
  const expectedLines = new Set(lineList);
  const filePath = join(confDir, fileName);
  const content = readFileSync(filePath, "utf-8");
  const diags = runDiagnostics(
    createDocument(content, `file://${filePath}`),
    versionSchema,
    version,
  ).filter((diag) => sampleCodes.has(diag.code));
  const actualLines = new Set(diags.map((diag) => diag.range.start.line + 1));
  const missing = [...expectedLines].filter((line) => !actualLines.has(line));
  const extra = [...actualLines].filter((line) => !expectedLines.has(line));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[${version}] ${fileName} mismatch: missing lines [${missing.join(", ")}], extra lines [${extra.join(", ")}]\n` +
        diags.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n"),
    );
  }
}

const sampleFixtureCases = [
  {
    file: "test-sample-fetch-args.cfg",
    lines: [15, 18, 21, 26, 29, 32, 35],
    label: "7 error lines",
  },
  {
    file: "test-sample-fetch-conv.cfg",
    lines: [15, 18, 21, 24, 29, 35, 38, 41],
    label: "8 error lines",
  },
  { file: "test-acl-args.cfg", lines: [15, 18, 21, 26, 29, 32, 35], label: "7 error lines" },
];

for (const version of VERSIONS) {
  const confDir = haproxyTreeDir(version, "tests", "conf");
  for (const { file, lines, label } of sampleFixtureCases) {
    process.stdout.write(`[${version}] ${file} sample diagnostics ... `);
    try {
      expectSampleLines(confDir, file, lines, schemas[version], version);
      console.log(`ok (${label})`);
    } catch (error) {
      console.log("FAIL");
      console.error(String(error.message ?? error));
      failed = true;
    }
  }
}

function expectErrorLines(confDir, fileName, codes, lineList, versionSchema, version) {
  const codeSet = new Set(codes);
  const expectedLines = new Set(lineList);
  const filePath = join(confDir, fileName);
  const content = readFileSync(filePath, "utf-8");
  const diags = runDiagnostics(
    createDocument(content, `file://${filePath}`),
    versionSchema,
    version,
  ).filter((diag) => codeSet.has(diag.code) && diag.severity === 0);
  const actualLines = new Set(diags.map((diag) => diag.range.start.line + 1));
  const missing = [...expectedLines].filter((line) => !actualLines.has(line));
  const extra = [...actualLines].filter((line) => !expectedLines.has(line));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[${version}] ${fileName} mismatch: missing lines [${missing.join(", ")}], extra lines [${extra.join(", ")}]\n` +
        diags.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n"),
    );
  }
}

for (const version of VERSIONS) {
  const confDir = haproxyTreeDir(version, "tests", "conf");
  process.stdout.write(`[${version}] test-valid-names.cfg name diagnostics ... `);
  try {
    expectErrorLines(
      confDir,
      "test-valid-names.cfg",
      ["invalid-name"],
      [23, 30],
      schemas[version],
      version,
    );
    console.log("ok (2 error lines)");
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }
}

process.stdout.write("hapee acl snippet ... ");
try {
  expectNoCode(hapeeAclSnippet, "hapee acl snippet", "sample-syntax");
  console.log("ok");
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

if (existsSync(hapeeCfgPath)) {
  process.stdout.write(`hapee ${hapeeCfgPath} sample-syntax ... `);
  try {
    expectNoCode(readFileSync(hapeeCfgPath, "utf-8"), "hapee haproxy.cfg", "sample-syntax");
    console.log("ok");
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }
}

for (const version of VERSIONS) {
  const confDir = haproxyTreeDir(version, "tests", "conf");
  process.stdout.write(`[${version}] test-address-syntax.cfg bind/name diagnostics ... `);
  try {
    expectErrorLines(
      confDir,
      "test-address-syntax.cfg",
      ["legacy-bind-syntax"],
      [12, 14, 18, 20, 22, 42, 50, 57, 64, 71, 78],
      schemas[version],
      version,
    );
    console.log("ok (11 legacy-bind lines)");
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
