#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const schemaPath = join(extensionRoot, "schemas", "haproxy-3.2.schema.json");
const mockVscodePath = join(__dirname, "mock-vscode.cjs");

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
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

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

function runCase(name, content, expectations) {
  const doc = createDocument(content);
  const diagnostics = computeDiagnostics(doc, schema);
  const byCode = new Map();
  for (const diag of diagnostics) {
    const code = diag.code ?? "unknown";
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }

  for (const [code, count] of Object.entries(expectations.counts ?? {})) {
    const actual = byCode.get(code) ?? 0;
    if (actual !== count) {
      throw new Error(
        `${name}: expected ${count} '${code}' diagnostic(s), got ${actual}\n` +
          diagnostics.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n")
      );
    }
  }

  const expectedTotal = expectations.total ?? Object.values(expectations.counts ?? {}).reduce((a, b) => a + b, 0);
  if (diagnostics.length !== expectedTotal) {
    throw new Error(
      `${name}: expected ${expectedTotal} total diagnostic(s), got ${diagnostics.length}\n` +
        diagnostics.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n")
    );
  }

  if (expectations.severity) {
    for (const diag of diagnostics) {
      if (diag.severity !== expectations.severity) {
        throw new Error(`${name}: expected severity ${expectations.severity}, got ${diag.severity} for ${diag.message}`);
      }
    }
  }
}

const validSnippet = readFileSync(join(__dirname, "fixtures", "basic-check-snippet.cfg"), "utf-8");
const invalidFixture = readFileSync(join(__dirname, "fixtures", "diagnostics-invalid.cfg"), "utf-8");

const cases = [
  {
    name: "valid snippet",
    content: validSnippet,
    expectations: { total: 0 },
  },
  {
    name: "bind in global",
    content: "frontend x\n\texternal-check\n",
    expectations: { total: 1, counts: { "wrong-section": 1 } },
  },
  {
    name: "unknown option",
    content: "defaults\n\toption notreal\n",
    expectations: { total: 1, counts: { "unknown-option": 1 } },
  },
  {
    name: "unknown mode",
    content: "listen x\n\tmode ftp\n",
    expectations: { total: 1, counts: { "unknown-value": 1 } },
  },
  {
    name: "mode extra argument",
    content: "listen x\n\tmode http this-is-not-valid\n",
    expectations: { total: 1, counts: { "extra-argument": 1 } },
  },
  {
    name: "balance unknown algorithm",
    content: "backend x\n\tbalance not-an-alg\n",
    expectations: { total: 1, counts: { "unknown-value": 1 } },
  },
  {
    name: "unknown acl criterion",
    content: "frontend x\n\tbind :80\n\tacl bad notreal\n",
    expectations: { total: 1, counts: { "unknown-criterion": 1 } },
  },
  {
    name: "unknown tcp-check step",
    content: "backend x\n\ttcp-check notreal\n",
    expectations: { total: 1, counts: { "unknown-keyword": 1 } },
  },
  {
    name: "unknown http-request action",
    content: "frontend x\n\tbind :80\n\thttp-request notreal if { always_true }\n",
    expectations: { total: 1, counts: { "unknown-action": 1 } },
  },
  {
    name: "server invalid address blah",
    content: "backend ssh\n\tserver check blah 127.0.0.1:22 check inter 1s\n",
    expectations: {
      total: 2,
      counts: { "invalid-address": 1, "reserved-name": 1 },
    },
  },
  {
    name: "server malformed ipv4",
    content: "backend ssh\n\tserver blah 127.0.0.1.2.8.7:22 check inter 1s\n",
    expectations: { total: 1, counts: { "invalid-address": 1 } },
  },
  {
    name: "server reserved name check",
    content: "backend ssh\n\tserver check 127.0.0.1:22\n",
    expectations: { total: 1, counts: { "reserved-name": 1 } },
  },
  {
    name: "server colon address with source",
    content: "backend b5\n\tserver s1 : source 127.0.0.1:15001\n",
    expectations: { total: 0 },
  },
  {
    name: "invalid fixture bundle",
    content: invalidFixture,
    expectations: {
      total: 6,
      counts: {
        "unknown-option": 1,
        "unknown-value": 1,
        "unknown-keyword": 1,
        "unknown-criterion": 1,
        "unknown-action": 1,
        "wrong-section": 1,
      },
    },
  },
];

let failed = false;
for (const testCase of cases) {
  process.stdout.write(`${testCase.name} ... `);
  try {
    runCase(testCase.name, testCase.content, testCase.expectations);
    console.log("ok");
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }
}

const confDir = resolve(extensionRoot, "..", "haproxy_git", "haproxy-3.2", "tests", "conf");
process.stdout.write(`all cfg in ${confDir} ... `);
try {
  const files = [];
  function collect(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        collect(full);
      } else if (entry.endsWith(".cfg")) {
        files.push(full);
      }
    }
  }
  const { readdirSync, statSync } = await import("node:fs");
  collect(confDir);
  let issueFiles = 0;
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const diags = computeDiagnostics(createDocument(content, `file://${file}`), schema).filter(
      (diag) => diag.code === "unknown-keyword" || diag.code === "wrong-section"
    );
    if (diags.length > 0) {
      issueFiles += 1;
    }
  }
  if (issueFiles > 0) {
    throw new Error(`${issueFiles}/${files.length} files have unexpected diagnostics`);
  }
  console.log(`ok (${files.length} files clean)`);
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

const portsPath = join(confDir, "ports.cfg");
process.stdout.write("ports.cfg address diagnostics ... ");
try {
  const portsContent = readFileSync(portsPath, "utf-8");
  const addressCodes = new Set([
    "invalid-address",
    "missing-port",
    "port-not-permitted",
    "port-range-not-permitted",
    "port-offset-not-permitted",
    "invalid-port",
  ]);
  const expectedLines = new Set([
    7, 8, 9, 11, 15, 16, 17, 20, 21, 22, 23, 24, 25, 30, 31, 32, 40, 48, 49, 55, 56, 57, 60, 63, 64,
    65, 72, 73, 74,
  ]);
  const portsDiags = computeDiagnostics(createDocument(portsContent, `file://${portsPath}`), schema).filter(
    (diag) => addressCodes.has(diag.code)
  );
  const actualLines = new Set(portsDiags.map((diag) => diag.range.start.line + 1));
  const missing = [...expectedLines].filter((line) => !actualLines.has(line));
  const extra = [...actualLines].filter((line) => !expectedLines.has(line));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `ports.cfg mismatch: missing lines [${missing.join(", ")}], extra lines [${extra.join(", ")}]`
    );
  }
  console.log(`ok (${expectedLines.size} error lines)`);
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
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

function expectSampleLines(fileName, lineList) {
  const expectedLines = new Set(lineList);
  const filePath = join(confDir, fileName);
  const content = readFileSync(filePath, "utf-8");
  const diags = computeDiagnostics(createDocument(content, `file://${filePath}`), schema).filter((diag) =>
    sampleCodes.has(diag.code)
  );
  const actualLines = new Set(diags.map((diag) => diag.range.start.line + 1));
  const missing = [...expectedLines].filter((line) => !actualLines.has(line));
  const extra = [...actualLines].filter((line) => !expectedLines.has(line));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${fileName} mismatch: missing lines [${missing.join(", ")}], extra lines [${extra.join(", ")}]\n` +
        diags.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n")
    );
  }
}

process.stdout.write("test-sample-fetch-args.cfg sample diagnostics ... ");
try {
  expectSampleLines("test-sample-fetch-args.cfg", [15, 18, 21, 26, 29, 32, 35]);
  console.log("ok (7 error lines)");
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

process.stdout.write("test-sample-fetch-conv.cfg sample diagnostics ... ");
try {
  expectSampleLines("test-sample-fetch-conv.cfg", [15, 18, 21, 24, 29, 35, 38, 41]);
  console.log("ok (8 error lines)");
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

process.stdout.write("test-acl-args.cfg sample diagnostics ... ");
try {
  expectSampleLines("test-acl-args.cfg", [15, 18, 21, 26, 29, 32, 35]);
  console.log("ok (7 error lines)");
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

function expectErrorLines(fileName, codes, lineList) {
  const codeSet = new Set(codes);
  const expectedLines = new Set(lineList);
  const filePath = join(confDir, fileName);
  const content = readFileSync(filePath, "utf-8");
  const diags = computeDiagnostics(createDocument(content, `file://${filePath}`), schema).filter(
    (diag) => codeSet.has(diag.code) && diag.severity === 0
  );
  const actualLines = new Set(diags.map((diag) => diag.range.start.line + 1));
  const missing = [...expectedLines].filter((line) => !actualLines.has(line));
  const extra = [...actualLines].filter((line) => !expectedLines.has(line));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${fileName} mismatch: missing lines [${missing.join(", ")}], extra lines [${extra.join(", ")}]\n` +
        diags.map((d) => `  L${d.range.start.line + 1}: [${d.code}] ${d.message}`).join("\n")
    );
  }
}

process.stdout.write("test-valid-names.cfg name diagnostics ... ");
try {
  expectErrorLines("test-valid-names.cfg", ["invalid-name"], [23, 30]);
  console.log("ok (2 error lines)");
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

process.stdout.write("test-address-syntax.cfg bind/name diagnostics ... ");
try {
  expectErrorLines(
    "test-address-syntax.cfg",
    ["legacy-bind-syntax"],
    [12, 14, 18, 20, 22, 42, 50, 57, 64, 71, 78]
  );
  console.log("ok (11 legacy-bind lines)");
} catch (error) {
  console.log("FAIL");
  console.error(String(error.message ?? error));
  failed = true;
}

process.exit(failed ? 1 : 0);
