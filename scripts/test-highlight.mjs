#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeDocument,
  findTokenOnLine,
  summarizeResults,
  tokenizeDocument,
} from "./highlight-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");
const defaultConfDir = resolve(extensionRoot, "..", "haproxy_git", "haproxy-3.2", "tests", "conf");

const FIXTURE_SNIPPETS = [
  readFileSync(join(__dirname, "fixtures", "test-stats-head.cfg"), "utf-8"),
  readFileSync(join(__dirname, "fixtures", "grammar-directives.cfg"), "utf-8"),
];

const NAME_SCOPE_FIXTURE = readFileSync(join(__dirname, "fixtures", "name-scopes.cfg"), "utf-8");

const SCOPES = {
  label: "entity.name.type.class.proxy.haproxy",
  acl: "entity.other.attribute-name.acl.haproxy",
  reference: "entity.name.type.proxy.haproxy",
};

const NAME_SCOPE_EXPECTATIONS = [
  { line: 1, text: "profile_default", scope: SCOPES.label },
  { line: 1, text: "fusion_defaults", scope: SCOPES.reference },
  { line: 2, text: "FRONTEND_PRD", scope: SCOPES.label },
  { line: 2, text: "profile_default", scope: SCOPES.reference },
  { line: 3, text: "acl_sample", scope: SCOPES.acl },
  { line: 4, text: "maintenance_cache", scope: SCOPES.label },
];

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

async function assertNameScopeFixture() {
  const lineTokens = await tokenizeDocument(NAME_SCOPE_FIXTURE);
  const mismatches = [];

  for (const { line, text, scope } of NAME_SCOPE_EXPECTATIONS) {
    const token = findTokenOnLine(lineTokens, line, text);
    if (token.displayScope !== scope) {
      mismatches.push(
        `  line ${line} "${text}": expected ${scope}, got ${token.displayScope}`
      );
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`name scope fixture:\n${mismatches.join("\n")}`);
  }
}

async function assertFixtureSnippetFullyScoped(content, label) {
  const { lineResults } = await analyzeDocument(content);
  const unscoped = lineResults.flatMap((line) =>
    line.unscoped.map((t) => ({ ...t, lineNo: line.lineNo }))
  );
  if (unscoped.length > 0) {
    const details = unscoped.map((t) => `  line ${t.lineNo} "${t.text}" scope=${t.displayScope}`).join("\n");
    throw new Error(`${label}: ${unscoped.length} unscoped token(s):\n${details}`);
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

  for (let i = 0; i < FIXTURE_SNIPPETS.length; i += 1) {
    const label = i === 0 ? "fixture snippet scoped" : "grammar directives fixture";
    process.stdout.write(`${label} ... `);
    try {
      await assertFixtureSnippetFullyScoped(FIXTURE_SNIPPETS[i], label);
      console.log("ok");
    } catch (error) {
      console.log("FAIL");
      console.error(String(error.message ?? error));
      failed = true;
    }
  }

  process.stdout.write("name scope fixture ... ");
  try {
    await assertNameScopeFixture();
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
