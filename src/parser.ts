import * as vscode from "vscode";

const SECTION_HEADERS = new Set([
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
  "http-errors",
  "ring",
  "cache",
  "crt-list",
  "crt-store",
  "traces",
  "acme",
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
}

function tokenizeLine(line: string): ParsedToken[] {
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

    if (/\s/.test(ch)) {
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

export function parseDocument(document: vscode.TextDocument): ParsedLine[] {
  const out: ParsedLine[] = [];
  let currentSection: string | null = null;

  for (let lineNo = 0; lineNo < document.lineCount; lineNo += 1) {
    const text = document.lineAt(lineNo).text;
    const tokens = tokenizeLine(text);
    let isSectionHeader = false;

    if (tokens.length > 0) {
      const first = tokens[0].text.toLowerCase();
      if (SECTION_HEADERS.has(first)) {
        currentSection = first;
        isSectionHeader = true;
      }
    }

    out.push({
      line: lineNo,
      section: currentSection,
      tokens,
      isSectionHeader,
    });
  }
  return out;
}
