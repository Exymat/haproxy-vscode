#!/usr/bin/env node
/**
 * Validate HAProxy .cfg files using the same diagnostic logic as the VS Code extension,
 * without requiring the vscode module.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { DEFAULT_VERSION } from "./lib/versions.mjs";
import { collectCfgFiles } from "./lib/fs-utils.mjs";
import { createDocument, loadCompiledModule, loadSchema } from "./lib/extension-runtime.mjs";

const { computeDiagnostics } = loadCompiledModule("diagnostics.js");
const schema = loadSchema(process.env.HAPROXY_VERSION ?? DEFAULT_VERSION);

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
