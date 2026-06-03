import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Registry } = require("vscode-textmate");
const { loadWASM, createOnigScanner, createOnigString } = require("vscode-oniguruma");

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(__dirname, "..");

let wasmReady = false;

export async function initTextMate() {
  if (wasmReady) {
    return;
  }
  const wasmPath = join(extensionRoot, "node_modules", "vscode-oniguruma", "release", "onig.wasm");
  const wasmBin = readFileSync(wasmPath);
  await loadWASM(wasmBin.buffer);
  wasmReady = true;
}

export function loadColorRules() {
  const pkg = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf-8"));
  const defaults = pkg.configurationDefaults ?? {};
  const topLevel = defaults["editor.tokenColorCustomizations"]?.textMateRules ?? [];
  if (topLevel.length > 0) {
    return topLevel;
  }
  const haproxyDefaults = defaults["[haproxy]"] ?? {};
  const legacy =
    haproxyDefaults["editor.tokenColorCustomizations"] ??
    haproxyDefaults.editor?.tokenColorCustomizations;
  return legacy?.textMateRules ?? [];
}

function normalizeRuleScopes(ruleScope) {
  if (Array.isArray(ruleScope)) {
    return ruleScope;
  }
  return [ruleScope];
}

function ruleMatchesScopes(ruleScope, scopes) {
  if (!ruleScope.includes(" ")) {
    return scopes.some((scope) => scope === ruleScope || scope.startsWith(`${ruleScope}.`));
  }
  const parts = ruleScope.split(/\s+/);
  let scopeIdx = scopes.length - 1;
  for (let partIdx = parts.length - 1; partIdx >= 0; partIdx -= 1) {
    const part = parts[partIdx];
    let matched = false;
    while (scopeIdx >= 0) {
      const scope = scopes[scopeIdx];
      if (scope === part || scope.startsWith(`${part}.`)) {
        matched = true;
        scopeIdx -= 1;
        break;
      }
      scopeIdx -= 1;
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

export function loadGrammarObject() {
  const grammarPath = join(extensionRoot, "syntaxes", "haproxy-active.tmLanguage.json");
  const raw = readFileSync(grammarPath, "utf-8").replace(/^\uFEFF/, "");
  const grammar = JSON.parse(raw);
  delete grammar.$schema;
  return grammar;
}

export async function createHaproxyGrammar() {
  await initTextMate();
  const registry = new Registry({
    theme: {
      name: "haproxy-test",
      settings: [],
    },
    onigLib: Promise.resolve({
      createOnigScanner,
      createOnigString,
    }),
  });
  return registry.addGrammar(loadGrammarObject());
}

function scopeSpecificity(scope) {
  return scope.split(".").length;
}

export function pickDisplayScope(scopes) {
  const meaningful = scopes.filter((s) => s !== "source.haproxy");
  if (meaningful.length === 0) {
    return scopes[0] ?? "source.haproxy";
  }
  return meaningful[meaningful.length - 1];
}

export function hasHaproxyScope(scopes) {
  return scopes.some((s) => s !== "source.haproxy");
}

export function resolveForeground(scopes, colorRules) {
  let best = null;
  for (const rule of colorRules) {
    for (const ruleScope of normalizeRuleScopes(rule.scope)) {
      if (!ruleMatchesScopes(ruleScope, scopes)) {
        continue;
      }
      const tail = ruleScope.includes(" ") ? ruleScope.split(/\s+/).pop() : ruleScope;
      const specificity = scopeSpecificity(tail.replace(/^source\.haproxy$/, "source.haproxy"));
      if (!best || specificity > best.specificity) {
        best = {
          color: rule.settings?.foreground ?? null,
          ruleScope,
          matchedScope: tail,
          specificity,
        };
      }
    }
  }
  return best?.color ?? null;
}

export function isWhitespaceToken(text) {
  return text.length === 0 || /^\s+$/.test(text);
}

export function classifyToken(lineText, token, nextStart, colorRules) {
  const text = lineText.slice(token.startIndex, nextStart);
  if (isWhitespaceToken(text)) {
    return null;
  }

  const displayScope = pickDisplayScope(token.scopes);
  const color = resolveForeground(token.scopes, colorRules);
  const scoped = hasHaproxyScope(token.scopes);
  return {
    text,
    startIndex: token.startIndex,
    scopes: token.scopes,
    displayScope,
    color: color ?? "UNCOLORED",
    scoped,
  };
}

export function analyzeLineTokens(lineText, tokens, colorRules) {
  const unscoped = [];
  const uncolored = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const nextStart = i + 1 < tokens.length ? tokens[i + 1].startIndex : lineText.length;
    const info = classifyToken(lineText, token, nextStart, colorRules);
    if (!info) {
      continue;
    }
    if (!info.scoped) {
      unscoped.push(info);
    } else if (colorRules.length > 0 && info.color === "UNCOLORED") {
      uncolored.push(info);
    }
  }
  return { unscoped, uncolored };
}

export async function analyzeDocument(content) {
  const grammar = await createHaproxyGrammar();
  const colorRules = loadColorRules();
  const lines = content.split(/\r?\n/);
  let ruleStack = null;
  const lineResults = [];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const lineText = lines[lineNo];
    const { tokens, ruleStack: nextStack } = grammar.tokenizeLine(lineText, ruleStack);
    ruleStack = nextStack;

    if (lineText.trim().length === 0) {
      continue;
    }

    const { unscoped, uncolored } = analyzeLineTokens(lineText, tokens, colorRules);
    if (unscoped.length > 0 || uncolored.length > 0) {
      lineResults.push({ lineNo: lineNo + 1, lineText, unscoped, uncolored });
    }
  }

  return { lineResults, colorRules };
}

export function summarizeResults(fileResults) {
  let totalUnscoped = 0;
  let totalUncolored = 0;
  let filesWithUnscoped = 0;
  let filesWithUncolored = 0;
  for (const result of fileResults) {
    const unscopedCount = result.lineResults.reduce((sum, line) => sum + line.unscoped.length, 0);
    const uncoloredCount = result.lineResults.reduce((sum, line) => sum + line.uncolored.length, 0);
    totalUnscoped += unscopedCount;
    totalUncolored += uncoloredCount;
    if (unscopedCount > 0) {
      filesWithUnscoped += 1;
    }
    if (uncoloredCount > 0) {
      filesWithUncolored += 1;
    }
  }
  return {
    totalUnscoped,
    totalUncolored,
    filesWithUnscoped,
    filesWithUncolored,
    totalFiles: fileResults.length,
  };
}
