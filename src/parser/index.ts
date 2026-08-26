/** Core HAProxy config line tokenizer and document parse types. */
import * as vscode from "vscode";

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
  return options?.sectionHeaders ?? new Set();
}

function isAsciiWhitespace(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code === 32 || (code >= 9 && code <= 13);
}

/**
 * Splits one HAProxy configuration line without decoding token contents.
 *
 * HAProxy treats every unprotected hash as a comment delimiter, permits
 * backslash escaping outside quotes and in weak quotes, and treats backslashes
 * literally in strong quotes. Keeping the raw source text here lets callers
 * retain exact ranges and formatting while sharing the same boundary rules.
 */
function scanLine(line: string, tokens?: ParsedToken[]): number {
  let i = 0;
  let tokenStart = -1;
  let quote: '"' | "'" | null = null;

  const flush = (end: number): void => {
    if (tokens && tokenStart >= 0 && end > tokenStart) {
      tokens.push({
        text: line.slice(tokenStart, end),
        start: tokenStart,
        end,
      });
    }
    tokenStart = -1;
  };

  while (i < line.length) {
    const ch = line[i];

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (quote === '"') {
      if (ch === "\\" && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (ch === '"') {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === "\\" && i + 1 < line.length) {
      if (tokenStart < 0) {
        tokenStart = i;
      }
      i += 2;
      continue;
    }

    if (ch === "#") {
      flush(i);
      return i;
    }

    if (isAsciiWhitespace(ch)) {
      flush(i);
      i += 1;
      continue;
    }

    if (tokenStart < 0) {
      tokenStart = i;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    }
    i += 1;
  }

  flush(line.length);
  return -1;
}

export function tokenizeLine(line: string): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  scanLine(line, tokens);
  return tokens;
}

export function commentStartIndex(line: string): number {
  return scanLine(line);
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
  const tokens = tokenizeLine(text);
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
  return parseDocumentLines(document.getText().split(/\r?\n/), options);
}
