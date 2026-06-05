#!/usr/bin/env node
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const { parseDocument } = require(join(extensionRoot, "out", "parser.js"));
const { buildSectionFoldRanges } = require(join(extensionRoot, "out", "sectionOutline.js"));

function createDocument(content) {
  const lines = content.split(/\r?\n/);
  return { lineCount: lines.length };
}

function runCase(name, content, expected) {
  const doc = createDocument(content);
  const parsed = parseDocument({
    lineCount: doc.lineCount,
    lineAt(lineNo) {
      return { text: content.split(/\r?\n/)[lineNo] ?? "" };
    },
  });
  const actual = buildSectionFoldRanges(parsed, doc.lineCount);
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${name}: fold range mismatch\n  expected: ${expectedJson}\n  actual:   ${actualJson}`
    );
  }
}

runCase("folds section body below header", "global\n    daemon\n    maxconn 100", [
  { startLine: 1, endLine: 2 },
]);

runCase("multiple sections", "global\n    daemon\n\ndefaults\n    mode http", [
  { startLine: 1, endLine: 2 },
  { startLine: 4, endLine: 4 },
]);

runCase("skips header-only section", "global\nfrontend web\n    bind :80", [
  { startLine: 2, endLine: 2 },
]);

runCase("ignores indented backend keyword", "frontend web\n    backend foo\n    bind :80", [
  { startLine: 1, endLine: 2 },
]);

console.log("folding tests passed: 4");
