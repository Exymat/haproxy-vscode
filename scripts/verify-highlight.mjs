#!/usr/bin/env node
/**
 * Verify TextMate highlighting for HAProxy .cfg files.
 *
 * Usage:
 *   node scripts/verify-highlight.mjs <conf-directory-or-file> [--json] [--max N]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocument, summarizeResults } from "./highlight-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = { json: false, summary: false, maxPerFile: 25, path: null };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--summary") {
      options.summary = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--max=")) {
      options.maxPerFile = Number.parseInt(arg.slice("--max=".length), 10);
    } else if (!arg.startsWith("-")) {
      options.path = arg;
    }
  }
  return options;
}

function collectCfgFiles(path) {
  const st = statSync(path);
  if (st.isFile()) {
    return path.endsWith(".cfg") ? [path] : [];
  }
  const files = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const entryStat = statSync(full);
    if (entryStat.isDirectory()) {
      files.push(...collectCfgFiles(full));
    } else if (entry.endsWith(".cfg")) {
      files.push(full);
    }
  }
  return files.sort();
}

async function analyzeFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const { lineResults, colorRules } = await analyzeDocument(content);
  return { filePath, lineResults, colorRules };
}

function printIssues(label, rel, lineResults, bucket, maxPerFile) {
  let shown = 0;
  for (const line of lineResults) {
    for (const token of line[bucket]) {
      if (shown >= maxPerFile) {
        console.log(`  ... truncated (${rel} has more ${label} tokens)`);
        return;
      }
      const col = token.startIndex + 1;
      console.log(
        `  ${rel}:${line.lineNo}:${col} "${token.text}" scope=${token.displayScope} color=${token.color}`
      );
      shown += 1;
    }
  }
}

function printHumanReport(basePath, fileResults, maxPerFile) {
  const summary = summarizeResults(fileResults);
  console.log("\n=== HAProxy highlight verification ===");
  console.log(`Path: ${basePath}`);
  console.log(`Total files: ${summary.totalFiles}`);
  console.log(`Files with unscoped tokens: ${summary.filesWithUnscoped}/${summary.totalFiles}`);
  console.log(`Files with uncolored tokens: ${summary.filesWithUncolored}/${summary.totalFiles}`);
  console.log(`Unscoped tokens (grammar gap): ${summary.totalUnscoped}`);
  console.log(`Uncolored tokens (color map gap): ${summary.totalUncolored}\n`);

  if (summary.totalUnscoped === 0 && summary.totalUncolored === 0) {
    console.log("All tokens have haproxy scopes and configured colors.\n");
    return;
  }

  if (summary.totalUnscoped > 0) {
    console.log("--- Unscoped tokens (white in editor) ---\n");
    for (const { filePath, lineResults } of fileResults) {
      const hasIssues = lineResults.some((line) => line.unscoped.length > 0);
      if (!hasIssues) {
        continue;
      }
      printIssues("unscoped", relative(basePath, filePath), lineResults, "unscoped", maxPerFile);
      console.log();
    }
  }

  if (summary.totalUncolored > 0) {
    console.log("--- Uncolored tokens (scoped but no extension color rule) ---\n");
    for (const { filePath, lineResults } of fileResults) {
      const hasIssues = lineResults.some((line) => line.uncolored.length > 0);
      if (!hasIssues) {
        continue;
      }
      printIssues("uncolored", relative(basePath, filePath), lineResults, "uncolored", maxPerFile);
      console.log();
    }
  }
}

function printScopeSummary(fileResults) {
  const unscopedByText = new Map();
  const coloredByScope = new Map();
  for (const { lineResults } of fileResults) {
    for (const line of lineResults) {
      for (const token of line.unscoped) {
        const key = token.text.trim().slice(0, 48) || "(whitespace)";
        unscopedByText.set(key, (unscopedByText.get(key) ?? 0) + 1);
      }
      for (const token of [...line.unscoped, ...line.uncolored]) {
        if (token.color !== "UNCOLORED") {
          coloredByScope.set(token.displayScope, token.color);
        }
      }
    }
  }
  console.log("\n--- Unscoped token samples (grammar gaps) ---\n");
  for (const [text, count] of [...unscopedByText.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`  ${count}x  "${text}"`);
  }
  if (coloredByScope.size > 0) {
    console.log("\n--- Scope → color map (from extension defaults) ---\n");
    for (const [scope, color] of [...coloredByScope.entries()].sort()) {
      console.log(`  ${scope}  →  ${color}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.path) {
    console.error(
      "Usage: node scripts/verify-highlight.mjs <conf-directory-or-file> [--json] [--summary] [--max=N] [--fail-on-uncolored]"
    );
    process.exit(options.help ? 0 : 1);
  }

  const absPath = resolve(options.path);
  const files = collectCfgFiles(absPath);
  if (files.length === 0) {
    console.error(`No .cfg files found at ${absPath}`);
    process.exit(1);
  }

  const fileResults = [];
  for (const file of files) {
    fileResults.push(await analyzeFile(file));
  }

  const summary = summarizeResults(fileResults);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          path: absPath,
          summary,
          files: fileResults.map(({ filePath, lineResults }) => ({
            file: relative(absPath, filePath),
            unscopedCount: lineResults.reduce((sum, line) => sum + line.unscoped.length, 0),
            uncoloredCount: lineResults.reduce((sum, line) => sum + line.uncolored.length, 0),
            lines: lineResults,
          })),
        },
        null,
        2
      )
    );
  } else {
    printHumanReport(absPath, fileResults, options.maxPerFile);
    if (options.summary) {
      printScopeSummary(fileResults);
    }
  }

  const failOnUncolored = process.argv.includes("--fail-on-uncolored");
  const hasIssues = summary.totalUnscoped > 0 || (failOnUncolored && summary.totalUncolored > 0);
  process.exit(hasIssues ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
