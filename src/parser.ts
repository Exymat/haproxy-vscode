import * as vscode from "vscode";

export const DEFAULT_SECTION_HEADERS = new Set([
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

export interface ParseOptions {
  sectionHeaders?: ReadonlySet<string>;
}

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
  /** Length of the line text excluding the line break. */
  textLength?: number;
}

export interface ParseState {
  currentSection: string | null;
  inAnonymousDefaults: boolean;
}

function resolvedSectionHeaders(options?: ParseOptions): ReadonlySet<string> {
  return options?.sectionHeaders ?? DEFAULT_SECTION_HEADERS;
}

function isAsciiWhitespace(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code === 32 || (code >= 9 && code <= 13);
}

export function tokenizeLine(line: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  const commentStart = commentStartIndex(line);
  const limit = commentStart >= 0 ? commentStart : line.length;
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

  while (i < limit) {
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

  flush(limit);
  return tokens;
}

export function commentStartIndex(line: string): number {
  let i = 0;
  let tokenStart = -1;
  let quote: '"' | "'" | null = null;
  let escaped = false;

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
      return i;
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
      tokenStart = -1;
      i += 1;
      continue;
    }

    if (tokenStart < 0) {
      tokenStart = i;
    }
    i += 1;
  }

  return -1;
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

export function initialParseState(): ParseState {
  return { currentSection: null, inAnonymousDefaults: false };
}

export function parseLine(
  text: string,
  lineNo: number,
  state: ParseState,
  options?: ParseOptions,
): { parsed: ParsedLine; nextState: ParseState } {
  const tokens = isCommentLine(text) ? [] : tokenizeLine(text);
  let currentSection = state.currentSection;
  let inAnonymousDefaults = state.inAnonymousDefaults;
  let isSectionHeader = false;
  const headers = resolvedSectionHeaders(options);

  if (tokens.length > 0) {
    const first = tokens[0].text.toLowerCase();
    if (headers.has(first)) {
      currentSection = first;
      isSectionHeader = true;
      inAnonymousDefaults = first === "defaults" && tokens.length === 1;
    }
  }

  return {
    parsed: {
      line: lineNo,
      section: currentSection,
      tokens,
      isSectionHeader,
      anonymousDefaults: inAnonymousDefaults,
      textLength: text.length,
    },
    nextState: {
      currentSection,
      inAnonymousDefaults,
    },
  };
}

export function parseDocumentLines(lineTexts: string[], options?: ParseOptions): ParsedLine[] {
  const out: ParsedLine[] = [];
  let state = initialParseState();

  for (let lineNo = 0; lineNo < lineTexts.length; lineNo += 1) {
    const next = parseLine(lineTexts[lineNo] ?? "", lineNo, state, options);
    out.push(next.parsed);
    state = next.nextState;
  }
  return out;
}

export function parseDocument(document: vscode.TextDocument, options?: ParseOptions): ParsedLine[] {
  const lineTexts = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
  return parseDocumentLines(lineTexts, options);
}
