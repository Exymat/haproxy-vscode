#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRLF = /\r\n/;
const vscodeignorePath = join(root, ".vscodeignore");
const vscodeignorePatterns = existsSync(vscodeignorePath)
  ? readFileSync(vscodeignorePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  : [];

/** @param {string} relativePath */
function isExcludedFromPackage(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return vscodeignorePatterns.some((pattern) => {
    const normalizedPattern = pattern.replaceAll("\\", "/");
    let source = "";
    for (let i = 0; i < normalizedPattern.length; i += 1) {
      const ch = normalizedPattern[i];
      if (ch === "*" && normalizedPattern[i + 1] === "*") {
        if (normalizedPattern[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else if (ch === "*") {
        source += "[^/]*";
      } else if (ch === "?") {
        source += "[^/]";
      } else {
        source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    return new RegExp(`^${source}$`).test(normalized);
  });
}

/** @param {string} message */
function fail(message) {
  console.error(`Package asset verification failed: ${message}`);
  process.exit(1);
}

/** @param {string} relativePath */
function assertLfJson(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    return;
  }

  const text = readFileSync(path, "utf8");
  if (CRLF.test(text)) {
    fail(
      `${relativePath} contains CRLF line endings (run "npm run format:generated" or regenerate schemas)`,
    );
  }
}

for (const name of readdirSync(join(root, "schemas"))) {
  if (name.endsWith(".json")) {
    assertLfJson(join("schemas", name));
  }
}

for (const name of readdirSync(join(root, "syntaxes"))) {
  if (name.startsWith("haproxy") && name.endsWith(".tmLanguage.json")) {
    assertLfJson(join("syntaxes", name));
  }
}

const outDir = join(root, "out");
const srcDir = join(root, "src");
const orphans = [];
const runtimeJsFiles = [];

/** @param {string} dir */
function walkOut(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkOut(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".js")) {
      continue;
    }

    const rel = relative(outDir, fullPath).replaceAll("\\", "/");
    if (rel.startsWith("test/")) {
      continue;
    }
    if (rel === "tooling/diagnostics.js") {
      continue;
    }

    runtimeJsFiles.push(rel);

    const tsPath = join(srcDir, rel.replace(/\.js$/, ".ts"));
    if (!existsSync(tsPath)) {
      orphans.push(rel);
    }
  }
}

if (existsSync(outDir)) {
  walkOut(outDir);
}

if (orphans.length > 0) {
  fail(
    `stale compiled files in out/ (no matching src/**/*.ts): ${orphans.sort().join(", ")} (run "npm run compile")`,
  );
}

if (runtimeJsFiles.length !== 1 || runtimeJsFiles[0] !== "extension.js") {
  fail(
    `out/ must contain only extension.js for the bundled runtime (found: ${runtimeJsFiles.sort().join(", ") || "(none)"})`,
  );
}

const toolingBundle = "out/tooling/diagnostics.js";
if (!existsSync(join(root, toolingBundle))) {
  fail(`missing diagnostics tooling bundle: ${toolingBundle}`);
}
if (!isExcludedFromPackage(toolingBundle)) {
  fail(`${toolingBundle} must be excluded from the VSIX`);
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifestGrammarPaths = new Set(
  (packageJson.contributes?.grammars ?? []).map((entry) =>
    entry.path.replace(/^\.\//, "").replaceAll("\\", "/"),
  ),
);

const syntaxDir = join(root, "syntaxes");
const unreferencedShippedGrammars = [];

for (const name of readdirSync(syntaxDir)) {
  if (!name.startsWith("haproxy") || !name.endsWith(".tmLanguage.json")) {
    continue;
  }

  const relativePath = join("syntaxes", name).replaceAll("\\", "/");
  if (isExcludedFromPackage(relativePath)) {
    continue;
  }

  if (!manifestGrammarPaths.has(relativePath)) {
    unreferencedShippedGrammars.push(relativePath);
  }
}

for (const grammarPath of manifestGrammarPaths) {
  if (!existsSync(join(root, grammarPath))) {
    fail(`package.json grammar path does not exist: ${grammarPath}`);
  }
}

if (unreferencedShippedGrammars.length > 0) {
  fail(
    `syntax files would ship in the VSIX but are not referenced in package.json grammars: ${unreferencedShippedGrammars.sort().join(", ")} (delete, exclude in .vscodeignore, or add to package.json)`,
  );
}

console.log("Package asset verification passed");
