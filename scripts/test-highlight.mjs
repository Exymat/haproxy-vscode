#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocument, summarizeResults } from "./highlight-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");
const defaultConfDir = resolve(extensionRoot, "..", "haproxy_git", "haproxy-3.2", "tests", "conf");

const FIXTURE_SNIPPET = readFileSync(join(__dirname, "fixtures", "test-stats-head.cfg"), "utf-8");

function collectCfgFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectCfgFiles(full));
    } else if (entry.endsWith(".cfg")) {
      files.push(full);
    }
  }
  return files.sort();
}

async function assertFixtureSnippetFullyScoped() {
  const { lineResults } = await analyzeDocument(FIXTURE_SNIPPET);
  const unscoped = lineResults.flatMap((line) =>
    line.unscoped.map((t) => ({ ...t, lineNo: line.lineNo }))
  );
  if (unscoped.length > 0) {
    const details = unscoped.map((t) => `  line ${t.lineNo} "${t.text}" scope=${t.displayScope}`).join("\n");
    throw new Error(`Fixture has ${unscoped.length} unscoped token(s):\n${details}`);
  }
}

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
  const confDir = process.argv[2] ? resolve(process.argv[2]) : defaultConfDir;
  let failed = false;

  process.stdout.write("fixture snippet scoped ... ");
  try {
    await assertFixtureSnippetFullyScoped();
    console.log("ok");
  } catch (error) {
    console.log("FAIL");
    console.error(String(error.message ?? error));
    failed = true;
  }

  process.stdout.write(`all cfg in ${confDir} ... `);
  try {
    const { summary } = await testConfDirectory(confDir);
    if (summary.totalUnscoped > 0) {
      console.log("FAIL");
      console.error(
        `${summary.totalUnscoped} unscoped token(s) across ${summary.filesWithUnscoped}/${summary.totalFiles} files`
      );
      failed = true;
    } else {
      console.log(`ok (${summary.totalFiles} files, all tokens scoped)`);
    }
  } catch (error) {
    console.log("FAIL");
    console.error(error);
    failed = true;
  }

  process.exit(failed ? 1 : 0);
}

main();
