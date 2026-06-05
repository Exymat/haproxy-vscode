#!/usr/bin/env node
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const { parseDocument } = require(join(extensionRoot, "out", "parser.js"));
const { buildSectionSymbols } = require(join(extensionRoot, "out", "sectionOutline.js"));

function createDocument(content) {
  const lines = content.split(/\r?\n/);
  return {
    lineCount: lines.length,
    lineAt(lineNo) {
      return { text: lines[lineNo] ?? "" };
    },
  };
}

function runCase(name, content, expected) {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  const symbols = buildSectionSymbols(parsed, doc.lineCount);
  const actual = symbols.map((symbol) => ({
    name: symbol.name,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  }));

  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${name}: symbol mismatch\n  expected: ${expectedJson}\n  actual:   ${actualJson}`
    );
  }
}

runCase("basic sections", "global\n    daemon\n\ndefaults\n    mode http\n", [
  { name: "global", startLine: 0, endLine: 2 },
  { name: "defaults", startLine: 3, endLine: 5 },
]);

runCase("named proxy sections", "frontend web\n    bind :80\nbackend api\n    server s1 127.0.0.1:8080", [
  { name: "frontend web", startLine: 0, endLine: 1 },
  { name: "backend api", startLine: 2, endLine: 3 },
]);

runCase("last section runs to EOF", "listen stats\n    bind :8888\n    stats uri /", [
  { name: "listen stats", startLine: 0, endLine: 2 },
]);

runCase("ignores indented false positives", "frontend web\n    backend foo", [
  { name: "frontend web", startLine: 0, endLine: 1 },
]);

console.log("document symbol tests passed: 4");
