#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "package.json");

/** @param {string} message */
function fail(message) {
  console.error(`package.json validation failed: ${message}`);
  process.exit(1);
}

/** @param {string} text */
export function extractNpmRunScriptNames(text) {
  const names = [];
  const pattern = /\bnpm run ([A-Za-z0-9:_.-]+)/g;
  let match = pattern.exec(text);
  while (match !== null) {
    names.push(match[1]);
    match = pattern.exec(text);
  }
  return names;
}

/**
 * @param {Record<string, string>} scripts
 * @param {string} source
 * @param {string} text
 * @returns {string[]}
 */
export function findMissingScriptReferences(scripts, source, text) {
  const missing = [];
  for (const name of extractNpmRunScriptNames(text)) {
    if (!(name in scripts)) {
      missing.push(`${source}: npm run ${name}`);
    }
  }
  return missing;
}

/**
 * @param {Record<string, string>} scripts
 * @param {{ workflowsDir?: string | null }} [options]
 * @returns {string[]}
 */
export function collectMissingScriptReferences(scripts, options = {}) {
  const missing = [];

  for (const [scriptName, command] of Object.entries(scripts)) {
    missing.push(
      ...findMissingScriptReferences(scripts, `package.json scripts.${scriptName}`, command),
    );
  }

  const workflowsDir =
    options.workflowsDir === undefined ? join(root, ".github", "workflows") : options.workflowsDir;
  if (workflowsDir && existsSync(workflowsDir)) {
    for (const fileName of readdirSync(workflowsDir)) {
      if (!fileName.endsWith(".yml") && !fileName.endsWith(".yaml")) {
        continue;
      }
      const workflowPath = join(workflowsDir, fileName);
      const workflowText = readFileSync(workflowPath, "utf8");
      missing.push(
        ...findMissingScriptReferences(scripts, `.github/workflows/${fileName}`, workflowText),
      );
    }
  }

  return missing;
}

const isMainModule =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
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
    const path = join(root, relativePath.replace(/^\.\//, ""));
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

  const scripts = pkg.scripts ?? {};
  const missingScriptReferences = collectMissingScriptReferences(scripts);
  if (missingScriptReferences.length > 0) {
    fail(
      `npm run references missing scripts:\n${[...new Set(missingScriptReferences)].map((line) => `  - ${line}`).join("\n")}`,
    );
  }

  console.log("package.json validation passed");
}
