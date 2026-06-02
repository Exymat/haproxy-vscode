#!/usr/bin/env node
/**
 * Validate HAProxy .cfg files using the same diagnostic logic as the VS Code extension,
 * without requiring the vscode module.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const schemaPath = join(extensionRoot, "schemas", "haproxy-3.0.schema.json");
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

function collectCfgFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectCfgFiles(full));
    } else if (entry.endsWith(".cfg")) {
      files.push(full);
    }
  }
  return files.sort();
}

function validateFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const doc = createDocument(content, `file://${filePath}`);
  const diagnostics = computeDiagnostics(doc, schema);
  return diagnostics.map((d) => ({
    line: d.range.start.line + 1,
    message: d.message,
  }));
}

function main() {
  const confDir = process.argv[2];
  if (!confDir) {
    console.error("Usage: node validate-conf.mjs <conf-directory>");
    process.exit(1);
  }

  const absConfDir = resolve(confDir);
  const files = collectCfgFiles(absConfDir);
  const results = [];
  let withIssues = 0;

  for (const file of files) {
    const diags = validateFile(file);
    if (diags.length > 0) {
      withIssues += 1;
    }
    results.push({ file, diags });
  }

  const clean = files.length - withIssues;
  console.log(`\n=== HAProxy config validation ===`);
  console.log(`Directory: ${absConfDir}`);
  console.log(`Total files: ${files.length}`);
  console.log(`Clean: ${clean}/${files.length}`);
  console.log(`With diagnostics: ${withIssues}/${files.length}\n`);

  if (withIssues === 0) {
    console.log("All configs clean.\n");
    return;
  }

  console.log("--- Diagnostics ---\n");
  for (const { file, diags } of results) {
    if (diags.length === 0) {
      continue;
    }
    const rel = relative(absConfDir, file);
    console.log(`${rel} (${diags.length} issue${diags.length === 1 ? "" : "s"}):`);
    for (const d of diags) {
      console.log(`  ${rel}:${d.line} ${d.message}`);
    }
    console.log();
  }
}

main();
