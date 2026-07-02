#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "package.json");
const ACTIVE_GRAMMAR = join(root, "syntaxes", "haproxy-active.tmLanguage.json");

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

function ensureActiveGrammar() {
  if (existsSync(ACTIVE_GRAMMAR)) {
    return;
  }

  const defaultVersion = pkg.contributes?.configuration?.properties?.["haproxy.version"]?.default;
  if (typeof defaultVersion !== "string" || defaultVersion.length === 0) {
    fail("cannot generate active grammar: missing haproxy.version default");
  }

  const sourceGrammar = join(root, "syntaxes", `haproxy-${defaultVersion}.tmLanguage.json`);
  if (!existsSync(sourceGrammar)) {
    fail(
      `cannot generate active grammar: missing source file syntaxes/haproxy-${defaultVersion}.tmLanguage.json`,
    );
  }

  copyFileSync(sourceGrammar, ACTIVE_GRAMMAR);
}

/** @param {string} relativePath */
function requireFile(relativePath) {
  const normalized = relativePath.replace(/^\.\//, "");
  if (normalized === "syntaxes/haproxy-active.tmLanguage.json") {
    ensureActiveGrammar();
  }

  const path = join(root, normalized);
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
