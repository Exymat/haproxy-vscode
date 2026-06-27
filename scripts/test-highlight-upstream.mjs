#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocument, summarizeResults } from "./highlight-lib.mjs";
import { collectCfgFiles } from "./lib/fs-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");
const haproxyGitRoot = resolve(extensionRoot, "..", "haproxy_git");
const defaultConfDir = resolve(haproxyGitRoot, "haproxy-3.2", "tests", "conf");

async function testConfDirectory(confDir) {
  const files = collectCfgFiles(confDir);
  const results = [];
  for (const file of files) {
    const { lineResults } = await analyzeDocument(readFileSync(file, "utf-8"));
    results.push({ file, lineResults });
  }
  return { summary: summarizeResults(results), results, files };
}

async function main() {
  if (!existsSync(haproxyGitRoot)) {
    console.log("test-highlight-upstream: skipped (haproxy_git not found)");
    process.exit(0);
  }

  const confDir = process.argv[2] ? resolve(process.argv[2]) : defaultConfDir;
  if (!existsSync(confDir)) {
    console.error(`test-highlight-upstream: directory not found: ${confDir}`);
    process.exit(1);
  }

  process.stdout.write(`all cfg in ${confDir} ... `);
  try {
    const { summary } = await testConfDirectory(confDir);
    if (summary.totalUnscoped > 0) {
      console.log("FAIL");
      console.error(
        `${summary.totalUnscoped} unscoped token(s) across ${summary.filesWithUnscoped}/${summary.totalFiles} files`,
      );
      process.exit(1);
    }
    console.log(`ok (${summary.totalFiles} files, all tokens scoped)`);
  } catch (error) {
    console.log("FAIL");
    console.error(error);
    process.exit(1);
  }
}

main();
