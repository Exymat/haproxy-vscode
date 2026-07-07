import { ParsedToken } from "./parser";

export interface EnvironmentVariableHit {
  name: string;
  start: number;
  end: number;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isNamePart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isIdentifierBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[A-Za-z0-9_.-]/.test(ch);
}

function isEscaped(text: string, offset: number): boolean {
  let count = 0;
  for (let i = offset - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

export function isEnvironmentVariableName(name: string): boolean {
  return ENV_NAME.test(name);
}

function findClosingBrace(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "}" && !isEscaped(text, i)) {
      return i;
    }
  }
  return -1;
}

function readVariableName(text: string, start: number): { name: string; end: number } | null {
  if (!isNameStart(text[start])) {
    return null;
  }
  let end = start + 1;
  while (isNamePart(text[end])) {
    end += 1;
  }
  return { name: text.slice(start, end), end };
}

function expansionAt(
  text: string,
  dollarOffset: number,
): { name: string; start: number; end: number } | null {
  if (isEscaped(text, dollarOffset)) {
    return null;
  }

  if (text[dollarOffset + 1] === "{") {
    const start = dollarOffset + 2;
    const name = readVariableName(text, start);
    if (!name) {
      return null;
    }

    const suffixStart = name.end;
    if (text[suffixStart] === "}") {
      return { name: name.name, start, end: name.end };
    }
    if (text.slice(suffixStart, suffixStart + 3) === "[*]" && text[suffixStart + 3] === "}") {
      return { name: name.name, start, end: name.end };
    }
    if (text[suffixStart] === "-" && findClosingBrace(text, suffixStart + 1) >= 0) {
      return { name: name.name, start, end: name.end };
    }
    return null;
  }

  const start = dollarOffset + 1;
  const name = readVariableName(text, start);
  return name ? { name: name.name, start, end: name.end } : null;
}

export function findQuotedEnvironmentExpansions(token: ParsedToken): EnvironmentVariableHit[] {
  const hits: EnvironmentVariableHit[] = [];
  const text = token.text;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && !isEscaped(text, i)) {
        quote = null;
        continue;
      }
      if (quote === '"' && ch === "$") {
        const hit = expansionAt(text, i);
        if (hit) {
          hits.push({
            name: hit.name,
            start: token.start + hit.start,
            end: token.start + hit.end,
          });
          i = hit.end - 1;
        }
      }
      continue;
    }

    if ((ch === '"' || ch === "'") && !isEscaped(text, i)) {
      quote = ch;
    }
  }

  return hits;
}

export function findEnvSampleFetchReferences(token: ParsedToken): EnvironmentVariableHit[] {
  const hits: EnvironmentVariableHit[] = [];
  const text = token.text;
  const lower = text.toLowerCase();
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const envOffset = lower.indexOf("env(", searchFrom);
    if (envOffset < 0) {
      break;
    }
    searchFrom = envOffset + 4;

    if (!isIdentifierBoundary(text[envOffset - 1])) {
      continue;
    }

    let nameStart = envOffset + 4;
    while (/\s/.test(text[nameStart] ?? "")) {
      nameStart += 1;
    }
    const name = readVariableName(text, nameStart);
    if (!name) {
      continue;
    }
    let afterName = name.end;
    while (/\s/.test(text[afterName] ?? "")) {
      afterName += 1;
    }
    if (text[afterName] !== ")") {
      continue;
    }

    hits.push({
      name: name.name,
      start: token.start + nameStart,
      end: token.start + name.end,
    });
    searchFrom = afterName + 1;
  }

  return hits;
}

export function findEnvironmentVariableReferences(token: ParsedToken): EnvironmentVariableHit[] {
  return [...findQuotedEnvironmentExpansions(token), ...findEnvSampleFetchReferences(token)];
}
