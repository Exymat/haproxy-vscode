import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { languageDataPath, schemaPath } from "./fs-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(__dirname, "..");
export const extensionRoot = resolve(scriptsDir, "..");
const mockVscodePath = join(scriptsDir, "mock-vscode.cjs");

let runtimeInitialized = false;

export function initExtensionRuntime() {
  if (runtimeInitialized) {
    return;
  }
  const require = createRequire(import.meta.url);
  const Module = require("module");
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "vscode") {
      return mockVscodePath;
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  runtimeInitialized = true;
}

export function loadCompiledModule(moduleRelativePath) {
  initExtensionRuntime();
  const require = createRequire(import.meta.url);
  return require(join(extensionRoot, "out", moduleRelativePath));
}

export function createDocument(content, uri = "file:///test.cfg") {
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

export function loadSchema(version) {
  const path = schemaPath(extensionRoot, version);
  if (!existsSync(path)) {
    throw new Error(`missing schema: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadLanguageData(version) {
  const path = languageDataPath(extensionRoot, version);
  if (!existsSync(path)) {
    throw new Error(`missing language data: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadDiagnosticSeverity() {
  initExtensionRuntime();
  const require = createRequire(import.meta.url);
  return require(mockVscodePath).DiagnosticSeverity;
}
