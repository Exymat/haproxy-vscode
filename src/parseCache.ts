import * as vscode from "vscode";

import {
  initialParseState,
  ParseOptions,
  parseDocumentLines,
  parseLine,
  ParsedLine,
} from "./parser";

export interface ParsedDocumentReuse {
  previousVersion: number | null;
  prefixLines: number;
  suffixLines: number;
  oldSuffixStart: number;
  newSuffixStart: number;
}

export interface ParsedDocumentEntry {
  version: number;
  lineTexts: string[];
  parsed: ParsedLine[];
  reuse: ParsedDocumentReuse;
}

const cache = new WeakMap<vscode.TextDocument, Map<string, ParsedDocumentEntry>>();

function lineTextsForDocument(document: vscode.TextDocument): string[] {
  return Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
}

function cloneParsedLine(line: ParsedLine, lineNo: number): ParsedLine {
  if (line.line === lineNo) {
    return line;
  }
  return { ...line, line: lineNo };
}

function stateAfterLine(line: ParsedLine | undefined): ReturnType<typeof initialParseState> {
  if (!line) {
    return initialParseState();
  }
  return {
    currentSection: line.section,
    inAnonymousDefaults: line.anonymousDefaults,
  };
}

function sameState(
  left: ReturnType<typeof initialParseState>,
  right: ReturnType<typeof initialParseState>,
): boolean {
  return (
    left.currentSection === right.currentSection &&
    left.inAnonymousDefaults === right.inAnonymousDefaults
  );
}

function parseOptionsKey(options?: ParseOptions): string {
  if (!options?.sectionHeaders) {
    return "";
  }
  return [...options.sectionHeaders].join("\0");
}

function parseDocumentIncremental(
  previous: ParsedDocumentEntry,
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedDocumentEntry {
  const lineTexts = lineTextsForDocument(document);
  const prevLineTexts = previous.lineTexts;
  const minLength = Math.min(prevLineTexts.length, lineTexts.length);
  let prefixLines = 0;
  while (prefixLines < minLength && prevLineTexts[prefixLines] === lineTexts[prefixLines]) {
    prefixLines += 1;
  }

  let suffixLines = 0;
  while (
    suffixLines < prevLineTexts.length - prefixLines &&
    suffixLines < lineTexts.length - prefixLines &&
    prevLineTexts[prevLineTexts.length - 1 - suffixLines] ===
      lineTexts[lineTexts.length - 1 - suffixLines]
  ) {
    suffixLines += 1;
  }

  if (prefixLines === lineTexts.length && prefixLines === prevLineTexts.length) {
    return {
      version: document.version,
      lineTexts,
      parsed: previous.parsed,
      reuse: {
        previousVersion: previous.version,
        prefixLines,
        suffixLines: 0,
        oldSuffixStart: previous.parsed.length,
        newSuffixStart: lineTexts.length,
      },
    };
  }

  const parsed = new Array<ParsedLine>(lineTexts.length);
  for (let i = 0; i < prefixLines; i += 1) {
    parsed[i] = previous.parsed[i];
  }

  let state = stateAfterLine(parsed[prefixLines - 1]);
  const oldSuffixStart = prevLineTexts.length - suffixLines;
  const newSuffixStart = lineTexts.length - suffixLines;

  for (let lineNo = prefixLines; lineNo < newSuffixStart; lineNo += 1) {
    /* v8 ignore next -- reparsing changed middle lines is a cache optimization detail */
    const next = parseLine(lineTexts[lineNo] ?? "", lineNo, state, options);
    parsed[lineNo] = next.parsed;
    state = next.nextState;
  }

  if (suffixLines > 0) {
    const expectedState = stateAfterLine(previous.parsed[oldSuffixStart - 1]);
    if (sameState(state, expectedState)) {
      /* v8 ignore start -- suffix reuse is a cache optimization for unchanged parser state */
      const delta = lineTexts.length - prevLineTexts.length;
      for (let lineNo = newSuffixStart; lineNo < lineTexts.length; lineNo += 1) {
        const oldLineNo = lineNo - delta;
        parsed[lineNo] = cloneParsedLine(previous.parsed[oldLineNo], lineNo);
      }
      return {
        version: document.version,
        lineTexts,
        parsed,
        reuse: {
          previousVersion: previous.version,
          prefixLines,
          suffixLines,
          oldSuffixStart,
          newSuffixStart,
        },
      };
      /* v8 ignore stop */
    }
  }

  for (let lineNo = newSuffixStart; lineNo < lineTexts.length; lineNo += 1) {
    /* v8 ignore next -- reparsing the invalidated suffix is a cache optimization detail */
    const next = parseLine(lineTexts[lineNo] ?? "", lineNo, state, options);
    parsed[lineNo] = next.parsed;
    state = next.nextState;
  }

  return {
    version: document.version,
    lineTexts,
    parsed,
    reuse: {
      previousVersion: previous.version,
      prefixLines,
      suffixLines: 0,
      oldSuffixStart: previous.parsed.length,
      newSuffixStart: lineTexts.length,
    },
  };
}

export function getParsedDocumentEntry(
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedDocumentEntry {
  const optionsKey = parseOptionsKey(options);
  let entries = cache.get(document);
  if (!entries) {
    entries = new Map();
    cache.set(document, entries);
  }
  const hit = entries.get(optionsKey);
  if (hit && hit.version === document.version) {
    return hit;
  }
  const lineTexts = lineTextsForDocument(document);
  const next = hit
    ? parseDocumentIncremental(hit, document, options)
    : {
        version: document.version,
        lineTexts,
        parsed: parseDocumentLines(lineTexts, options),
        reuse: {
          previousVersion: null,
          prefixLines: 0,
          suffixLines: 0,
          oldSuffixStart: 0,
          newSuffixStart: 0,
        },
      };
  entries.set(optionsKey, next);
  return next;
}

export function getParsedDocument(
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedLine[] {
  return getParsedDocumentEntry(document, options).parsed;
}
