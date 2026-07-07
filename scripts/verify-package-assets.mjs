#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRLF = /\r\n/;

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

console.log("Package asset verification passed");
