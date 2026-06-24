import * as vscode from "vscode";

export const SECTION_HEADERS = new Set([
  "global",
  "defaults",
  "frontend",
  "backend",
  "listen",
  "peers",
  "userlist",
  "resolvers",
  "mailers",
  "program",
  "healthcheck",
  "http-errors",
  "ring",
  "cache",
  "crt-list",
  "crt-store",
  "traces",
  "acme",
  "log-forward",
  "log-profile",
]);

export interface ParsedToken {
  text: string;
  start: number;
  end: number;
}

export interface ParsedLine {
  line: number;
  section: string | null;
  tokens: ParsedToken[];
  isSectionHeader: boolean;
  /** True when this line is inside an anonymous (unnamed) defaults section. */
  anonymousDefaults: boolean;
}

function isAsciiWhitespace(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code === 32 || (code >= 9 && code <= 13);
}

export function tokenizeLine(line: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  let i = 0;
  let tokenStart = -1;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const flush = (end: number): void => {
    if (tokenStart >= 0 && end > tokenStart) {
      tokens.push({
        text: line.slice(tokenStart, end),
        start: tokenStart,
        end,
      });
      tokenStart = -1;
    }
  };

  while (i < line.length) {
    const ch = line[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === "#" && tokenStart < 0) {
      break;
    }

    if (ch === "'" || ch === '"') {
      if (tokenStart < 0) {
        tokenStart = i;
      }
      quote = ch;
      i += 1;
      continue;
    }

    if (isAsciiWhitespace(ch)) {
      flush(i);
      i += 1;
      continue;
    }

    if (tokenStart < 0) {
      tokenStart = i;
    }
    i += 1;
  }

  flush(i);
  return tokens;
}

function isCommentLine(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "#") {
      return true;
    }
    if (!isAsciiWhitespace(ch)) {
      return false;
    }
  }
  return false;
}

export function parseDocument(document: vscode.TextDocument): ParsedLine[] {
  const out: ParsedLine[] = [];
  let currentSection: string | null = null;
  let inAnonymousDefaults = false;

  for (let lineNo = 0; lineNo < document.lineCount; lineNo += 1) {
    const text = document.lineAt(lineNo).text;
    const tokens = isCommentLine(text) ? [] : tokenizeLine(text);
    let isSectionHeader = false;

    if (tokens.length > 0) {
      const first = tokens[0].text.toLowerCase();
      if (SECTION_HEADERS.has(first)) {
        currentSection = first;
        isSectionHeader = true;
        inAnonymousDefaults = first === "defaults" && tokens.length === 1;
      }
    }

    out.push({
      line: lineNo,
      section: currentSection,
      tokens,
      isSectionHeader,
      anonymousDefaults: inAnonymousDefaults,
    });
  }
  return out;
}
