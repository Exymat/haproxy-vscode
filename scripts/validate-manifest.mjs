#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "package.json");

/** @param {string} message */
function fail(message) {
  console.error(`package.json validation failed: ${message}`);
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

for (const field of ["name", "version", "publisher", "engines", "main", "contributes"]) {
  if (pkg[field] == null || pkg[field] === "") {
    fail(`missing required field: ${field}`);
  }
}

if (!pkg.engines?.vscode) {
  fail("missing engines.vscode");
}

if (!pkg.engines?.node) {
  fail("missing engines.node");
}

/** @param {string} relativePath */
function requireFile(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    fail(`missing file referenced in package.json: ${relativePath}`);
  }
}

if (pkg.icon) {
  requireFile(pkg.icon);
}

for (const grammar of pkg.contributes?.grammars ?? []) {
  if (!grammar.path) {
    fail("grammar entry is missing path");
  }
  requireFile(grammar.path);
}

for (const language of pkg.contributes?.languages ?? []) {
  if (language.configuration) {
    requireFile(language.configuration);
  }
}

console.log("package.json validation passed");
