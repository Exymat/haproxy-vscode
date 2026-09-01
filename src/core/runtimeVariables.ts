/** Finds HAProxy runtime-variable names in `set-var` / `var(...)` forms. */
import { ParsedLine, ParsedToken } from "../parser";

export const RUNTIME_VARIABLE_SCOPES = ["proc", "sess", "txn", "req", "res", "check"] as const;

export type RuntimeVariableRole = "definition" | "reference";

export interface RuntimeVariableHit {
  name: string;
  start: number;
  end: number;
  role: RuntimeVariableRole;
}

const RUNTIME_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const PAREN_KEYWORDS: ReadonlyArray<{ needle: string; role: RuntimeVariableRole }> = [
  { needle: "set-var-fmt(", role: "definition" },
  { needle: "unset-var(", role: "reference" },
  { needle: "set-var(", role: "definition" },
  { needle: "var(", role: "reference" },
];

const UNPARENTHESIZED_DEFINITION_KEYWORDS = new Set(["set-var", "set-var-fmt"]);

function isIdentifierBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[A-Za-z0-9_.-]/.test(ch);
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (/\s/.test(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

function readRuntimeVariableName(
  text: string,
  start: number,
): { name: string; end: number } | null {
  if (!text[start] || !/[A-Za-z_]/.test(text[start])) {
    return null;
  }
  let end = start + 1;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end] ?? "")) {
    end += 1;
  }
  while (text[end] === ".") {
    const partStart = end + 1;
    if (!text[partStart] || !/[A-Za-z_]/.test(text[partStart])) {
      return null;
    }
    end = partStart + 1;
    while (end < text.length && /[A-Za-z0-9_]/.test(text[end] ?? "")) {
      end += 1;
    }
  }
  return { name: text.slice(start, end), end };
}

function firstArgumentRange(text: string, openParenOffset: number): { start: number; end: number } {
  const start = skipWhitespace(text, openParenOffset + 1);
  let end = start;
  while (end < text.length && text[end] !== "," && text[end] !== ")") {
    end += 1;
  }
  return { start, end };
}

function keywordAt(
  lower: string,
  offset: number,
): { needle: string; role: RuntimeVariableRole } | null {
  for (const keyword of PAREN_KEYWORDS) {
    if (lower.startsWith(keyword.needle, offset)) {
      return keyword;
    }
  }
  return null;
}

export function isRuntimeVariableName(name: string): boolean {
  return RUNTIME_VARIABLE_NAME.test(name);
}

export function tokenMayContainRuntimeVariables(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("var(");
}

export function findRuntimeVariableHits(token: ParsedToken): RuntimeVariableHit[] {
  const hits: RuntimeVariableHit[] = [];
  const { text } = token;
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < text.length) {
    const keyword = keywordAt(lower, offset);
    if (!keyword || !isIdentifierBoundary(text[offset - 1])) {
      offset += 1;
      continue;
    }

    const openParen = offset + keyword.needle.length - 1;
    const arg = firstArgumentRange(text, openParen);
    const name = readRuntimeVariableName(text, arg.start);
    if (name && isRuntimeVariableName(name.name)) {
      const afterName = skipWhitespace(text, name.end);
      if (afterName === arg.end) {
        hits.push({
          name: name.name,
          start: token.start + name.end - name.name.length,
          end: token.start + name.end,
          role: keyword.role,
        });
      }
    }
    offset = Math.max(openParen + 1, arg.start);
  }

  return hits;
}

export function runtimeVariableArgumentExpectedAt(token: ParsedToken, character: number): boolean {
  if (!tokenMayContainRuntimeVariables(token.text)) {
    return false;
  }
  const { text } = token;
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < text.length) {
    const keyword = keywordAt(lower, offset);
    if (!keyword || !isIdentifierBoundary(text[offset - 1])) {
      offset += 1;
      continue;
    }

    const openParen = offset + keyword.needle.length - 1;
    const arg = firstArgumentRange(text, openParen);
    const argStart = token.start + arg.start;
    const argEnd = token.start + arg.end;
    if (character >= argStart && character <= Math.max(argEnd, argStart)) {
      return true;
    }
    offset = Math.max(openParen + 1, arg.start);
  }

  return false;
}

export function findUnparenthesizedRuntimeVariable(line: ParsedLine): RuntimeVariableHit | null {
  for (let i = 0; i < line.tokens.length; i += 1) {
    const keyword = line.tokens[i];
    const nameToken = line.tokens[i + 1];
    if (!keyword || !nameToken) {
      continue;
    }
    if (!UNPARENTHESIZED_DEFINITION_KEYWORDS.has(keyword.text.toLowerCase())) {
      continue;
    }
    if (!isRuntimeVariableName(nameToken.text)) {
      continue;
    }
    return {
      name: nameToken.text,
      start: nameToken.start,
      end: nameToken.end,
      role: "definition",
    };
  }
  return null;
}

export function unparenthesizedRuntimeVariableExpectedAt(
  line: ParsedLine,
  tokenIndex: number,
  character: number,
): boolean {
  for (let i = 0; i < line.tokens.length; i += 1) {
    const keyword = line.tokens[i];
    if (!keyword || !UNPARENTHESIZED_DEFINITION_KEYWORDS.has(keyword.text.toLowerCase())) {
      continue;
    }
    const nameIndex = i + 1;
    if (tokenIndex !== nameIndex) {
      continue;
    }
    const nameToken = line.tokens[nameIndex];
    if (!nameToken) {
      return character > keyword.end;
    }
    return character >= nameToken.start && character <= nameToken.end;
  }
  return false;
}

export function runtimeVariableNameExpectedAt(
  line: ParsedLine,
  tokenIndex: number,
  character: number,
): boolean {
  for (const token of line.tokens) {
    if (!token) {
      continue;
    }
    if (runtimeVariableArgumentExpectedAt(token, character)) {
      return true;
    }
  }
  return unparenthesizedRuntimeVariableExpectedAt(line, tokenIndex, character);
}
