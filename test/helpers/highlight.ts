import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// CJS packages loaded in the Vitest Node environment.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Registry } = require("vscode-textmate");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadWASM, createOnigScanner, createOnigString } = require("vscode-oniguruma");

const extensionRoot = join(__dirname, "..", "..");

let wasmReady = false;

export async function initTextMate(): Promise<void> {
  if (wasmReady) {
    return;
  }
  const wasmPath = join(extensionRoot, "node_modules", "vscode-oniguruma", "release", "onig.wasm");
  const wasmBin = readFileSync(wasmPath);
  await loadWASM(wasmBin.buffer);
  wasmReady = true;
}

export function loadColorRules(): Array<{
  scope: string | string[];
  settings?: { foreground?: string };
}> {
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

function normalizeRuleScopes(ruleScope: string | string[]): string[] {
  return Array.isArray(ruleScope) ? ruleScope : [ruleScope];
}

function ruleMatchesScopes(ruleScope: string, scopes: string[]): boolean {
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

export function loadGrammarObject(): Record<string, unknown> {
  const activePath = join(extensionRoot, "syntaxes", "haproxy-active.tmLanguage.json");
  const fallbackPath = join(extensionRoot, "syntaxes", "haproxy-3.2.tmLanguage.json");
  const grammarPath = existsSync(activePath) ? activePath : fallbackPath;
  const raw = readFileSync(grammarPath, "utf-8").replace(/^\uFEFF/, "");
  const grammar = JSON.parse(raw) as Record<string, unknown>;
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

function scopeSpecificity(scope: string): number {
  return scope.split(".").length;
}

export function pickDisplayScope(scopes: string[]): string {
  const meaningful = scopes.filter((s) => s !== "source.haproxy");
  if (meaningful.length === 0) {
    return scopes[0] ?? "source.haproxy";
  }
  return meaningful[meaningful.length - 1];
}

function hasHaproxyScope(scopes: string[]): boolean {
  return scopes.some((s) => s !== "source.haproxy");
}

function resolveForeground(
  scopes: string[],
  colorRules: Array<{ scope: string | string[]; settings?: { foreground?: string } }>,
) {
  let best: { color: string | null; specificity: number } | null = null;
  for (const rule of colorRules) {
    for (const ruleScope of normalizeRuleScopes(rule.scope)) {
      if (!ruleMatchesScopes(ruleScope, scopes)) {
        continue;
      }
      const tail = ruleScope.includes(" ") ? ruleScope.split(/\s+/).pop()! : ruleScope;
      const specificity = scopeSpecificity(tail.replace(/^source\.haproxy$/, "source.haproxy"));
      if (!best || specificity > best.specificity) {
        best = {
          color: rule.settings?.foreground ?? null,
          specificity,
        };
      }
    }
  }
  return best?.color ?? null;
}

function isWhitespaceToken(text: string): boolean {
  return text.length === 0 || /^\s+$/.test(text);
}

interface ClassifiedToken {
  text: string;
  startIndex: number;
  scopes: string[];
  displayScope: string;
  color: string;
  scoped: boolean;
}

function classifyToken(
  lineText: string,
  token: { startIndex: number; scopes: string[] },
  nextStart: number,
  colorRules: Array<{ scope: string | string[]; settings?: { foreground?: string } }>,
): ClassifiedToken | null {
  const text = lineText.slice(token.startIndex, nextStart);
  if (isWhitespaceToken(text)) {
    return null;
  }
  const displayScope = pickDisplayScope(token.scopes);
  const color = resolveForeground(token.scopes, colorRules);
  return {
    text,
    startIndex: token.startIndex,
    scopes: token.scopes,
    displayScope,
    color: color ?? "UNCOLORED",
    scoped: hasHaproxyScope(token.scopes),
  };
}

export async function analyzeDocument(content: string) {
  const grammar = await createHaproxyGrammar();
  const colorRules = loadColorRules();
  const lines = content.split(/\r?\n/);
  let ruleStack: unknown = null;
  const lineResults: Array<{
    lineNo: number;
    lineText: string;
    unscoped: ClassifiedToken[];
    uncolored: ClassifiedToken[];
  }> = [];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const lineText = lines[lineNo];
    const { tokens, ruleStack: nextStack } = grammar.tokenizeLine(lineText, ruleStack);
    ruleStack = nextStack;

    if (lineText.trim().length === 0) {
      continue;
    }

    const unscoped: ClassifiedToken[] = [];
    const uncolored: ClassifiedToken[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const nextStart = i + 1 < tokens.length ? tokens[i + 1].startIndex : lineText.length;
      const info = classifyToken(lineText, tokens[i], nextStart, colorRules);
      if (!info) {
        continue;
      }
      if (!info.scoped) {
        unscoped.push(info);
      } else if (colorRules.length > 0 && info.color === "UNCOLORED") {
        uncolored.push(info);
      }
    }
    if (unscoped.length > 0 || uncolored.length > 0) {
      lineResults.push({ lineNo: lineNo + 1, lineText, unscoped, uncolored });
    }
  }

  return { lineResults, colorRules };
}

export async function tokenizeDocument(content: string) {
  const grammar = await createHaproxyGrammar();
  const colorRules = loadColorRules();
  const lines = content.split(/\r?\n/);
  let ruleStack: unknown = null;
  const lineTokens: Array<{ lineNo: number; lineText: string; tokens: ClassifiedToken[] }> = [];

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const lineText = lines[lineNo];
    const { tokens, ruleStack: nextStack } = grammar.tokenizeLine(lineText, ruleStack);
    ruleStack = nextStack;
    const classified: ClassifiedToken[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const nextStart = i + 1 < tokens.length ? tokens[i + 1].startIndex : lineText.length;
      const info = classifyToken(lineText, tokens[i], nextStart, colorRules);
      if (info) {
        classified.push(info);
      }
    }
    lineTokens.push({ lineNo: lineNo + 1, lineText, tokens: classified });
  }

  return lineTokens;
}

export function findTokenOnLine(
  lineTokens: Awaited<ReturnType<typeof tokenizeDocument>>,
  lineNo: number,
  text: string,
) {
  const line = lineTokens.find((entry) => entry.lineNo === lineNo);
  if (!line) {
    throw new Error(`line ${lineNo} not found in fixture`);
  }
  const matches = line.tokens.filter((token) => token.text === text);
  if (matches.length !== 1) {
    const found = matches.map((token) => `"${token.text}"→${token.displayScope}`).join(", ");
    throw new Error(
      `line ${lineNo}: expected 1 token "${text}", found ${matches.length}${found ? `: ${found}` : ""}`,
    );
  }
  return matches[0];
}
