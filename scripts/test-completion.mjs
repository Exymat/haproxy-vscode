#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const VERSIONS = ["3.2", "3.4"];
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

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

const CompletionItemKind = { Value: 12, Keyword: 14, Module: 19 };

class Hover {
  constructor(contents, range) {
    this.contents = contents;
    this.range = range;
  }
}

const vscode = require("vscode");
vscode.CompletionItem = CompletionItem;
vscode.CompletionItemKind = CompletionItemKind;
vscode.Hover = Hover;
vscode.MarkdownString = class MarkdownString {
  constructor() {
    this.value = "";
  }
  appendMarkdown(text) {
    this.value += text;
  }
};

const { provideCompletionItems } = require(join(extensionRoot, "out", "completion.js"));
const { provideHover } = require(join(extensionRoot, "out", "hover.js"));
const { getDocumentContext } = require(join(extensionRoot, "out", "documentContext.js"));

function loadBundle(version) {
  const schemaPath = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
  const languagePath = join(extensionRoot, "schemas", `haproxy-${version}.language.json`);
  if (!existsSync(schemaPath) || !existsSync(languagePath)) {
    throw new Error(`missing schema bundle for ${version}`);
  }
  return {
    schema: JSON.parse(readFileSync(schemaPath, "utf-8")),
    languageData: JSON.parse(readFileSync(languagePath, "utf-8")),
  };
}

const bundles = Object.fromEntries(VERSIONS.map((version) => [version, loadBundle(version)]));

function createDocument(content, uri = "file:///test.cfg") {
  const lines = content.split(/\r?\n/);
  return {
    uri,
    version: 1,
    lineCount: lines.length,
    lineAt(lineNo) {
      return { text: lines[lineNo] ?? "" };
    },
    getText(range) {
      if (!range) {
        return content;
      }
      const line = lines[range.start.line] ?? "";
      return line.slice(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(position, pattern) {
      const line = lines[position.line] ?? "";
      const before = line.slice(0, position.character);
      const match = before.match(/([a-zA-Z0-9_.-]+)$/);
      if (!match) {
        return undefined;
      }
      const start = position.character - match[1].length;
      return {
        start: { line: position.line, character: start },
        end: { line: position.line, character: position.character },
      };
    },
  };
}

function completionLabels(content, lineNo, character, version) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const items = provideCompletionItems(
    doc,
    { line: lineNo, character },
    bundle.languageData,
    bundle.schema
  );
  return items.map((item) => item.label).sort();
}

function hoverText(content, lineNo, character, version) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const hover = provideHover(doc, { line: lineNo, character }, bundle.languageData, bundle.schema);
  if (!hover) {
    return "";
  }
  const md = Array.isArray(hover.contents) ? hover.contents[0] : hover.contents;
  return typeof md === "string" ? md : md?.value ?? "";
}

function contextKind(content, lineNo, character, version) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const ctx = getDocumentContext(doc, { line: lineNo, character }, bundle.schema);
  return ctx?.kind ?? null;
}

function assertIncludes(labels, expected, message) {
  for (const name of expected) {
    if (!labels.includes(name)) {
      throw new Error(`${message}: expected '${name}' in [${labels.join(", ")}]`);
    }
  }
}

function assertExcludes(labels, unexpected, message) {
  for (const name of unexpected) {
    if (labels.includes(name)) {
      throw new Error(`${message}: did not expect '${name}' in [${labels.join(", ")}]`);
    }
  }
}

// After "mode " the cursor should be in argument context, not directive keyword context.
const modeAfterSpace = "defaults\n    mode ";
const lineNo = 1;
const cursor = modeAfterSpace.split("\n")[1].length;
if (contextKind(modeAfterSpace, lineNo, cursor, "3.4") !== "directive-argument") {
  throw new Error(`mode after space: expected directive-argument context`);
}

const modeCompletions = completionLabels(modeAfterSpace, lineNo, cursor, "3.4");
assertIncludes(modeCompletions, ["tcp", "http", "haterm", "log", "spop"], "mode completions on 3.4");
assertExcludes(modeCompletions, ["acl", "bind", "balance"], "mode completions should not suggest section keywords");

const modePrefix = "defaults\n    mode h";
const modePrefixCursor = modePrefix.split("\n")[1].length;
const modePrefixCompletions = completionLabels(modePrefix, lineNo, modePrefixCursor, "3.4");
assertIncludes(modePrefixCompletions, ["http", "haterm"], "mode prefix 'h' completions");

const modeHover34 = hoverText("defaults\n    mode", lineNo, 7, "3.4");
if (!modeHover34.includes("haterm")) {
  throw new Error(`mode hover on 3.4 should mention haterm, got: ${modeHover34}`);
}

const modeHover32 = hoverText("defaults\n    mode", lineNo, 7, "3.2");
if (modeHover32.includes("haterm")) {
  throw new Error(`mode hover on 3.2 should not mention haterm`);
}

const enumCases = [
  { directive: "http-reuse ", section: "defaults", expected: ["never", "safe", "aggressive", "always"], forbidden: ["acl"] },
  { directive: "hash-preserve-affinity ", section: "backend", expected: ["always", "maxconn", "maxqueue"], forbidden: ["acl"] },
  { directive: "default-path ", section: "global", expected: ["current", "config", "parent"], forbidden: ["acl"] },
  { directive: "chroot ", section: "global", expected: ["auto"], forbidden: ["acl"] },
  { directive: "filter-sequence ", section: "frontend", expected: ["request", "response"], forbidden: ["acl"] },
  { directive: "balance ", section: "defaults", expected: ["roundrobin", "leastconn"], forbidden: ["acl"] },
  { directive: "compression algo ", section: "defaults", expected: [], forbidden: ["algo", "acl"] },
];

for (const testCase of enumCases) {
  const content = `${testCase.section}\n    ${testCase.directive}`;
  const testLine = 1;
  const cursor = content.split("\n")[1].length;
  const labels = completionLabels(content, testLine, cursor, "3.4");
  assertIncludes(labels, testCase.expected, `${testCase.directive.trim()} completions`);
  assertExcludes(labels, testCase.forbidden, `${testCase.directive.trim()} should not suggest`);
}

process.stdout.write("completion + hover tests passed\n");
