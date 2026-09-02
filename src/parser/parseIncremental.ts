/** Incremental parse algorithm for HAProxy documents, independent of cache storage. */
import * as vscode from "vscode";

import {
  initialParseState,
  ParseOptions,
  parseDocumentLines,
  parseLine,
  ParsedLine,
} from "./index";

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

export function parseOptionsKey(options?: ParseOptions): string {
  if (!options?.sectionHeaders) {
    return "";
  }
  return [...options.sectionHeaders].sort().join("\0");
}

export function lineTextsForDocument(document: vscode.TextDocument): string[] {
  return document.getText().split(/\r?\n/);
}

export function emptyParseReuse(): ParsedDocumentReuse {
  return {
    previousVersion: null,
    prefixLines: 0,
    suffixLines: 0,
    oldSuffixStart: 0,
    newSuffixStart: 0,
  };
}

export function restoredParseReuse(length: number, previousVersion: number): ParsedDocumentReuse {
  return {
    previousVersion,
    prefixLines: length,
    suffixLines: 0,
    oldSuffixStart: length,
    newSuffixStart: length,
  };
}

export function parseDocumentFresh(
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedDocumentEntry {
  const lineTexts = lineTextsForDocument(document);
  return {
    version: document.version,
    lineTexts,
    parsed: parseDocumentLines(lineTexts, options),
    reuse: emptyParseReuse(),
  };
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

function reuseWindow(
  prevLineTexts: string[],
  lineTexts: string[],
): { prefixLines: number; suffixLines: number } {
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
  return { prefixLines, suffixLines };
}

function parseDirtyRange(
  lineTexts: string[],
  parsed: ParsedLine[],
  start: number,
  end: number,
  state: ReturnType<typeof initialParseState>,
  options?: ParseOptions,
): ReturnType<typeof initialParseState> {
  let nextState = state;
  for (let lineNo = start; lineNo < end; lineNo += 1) {
    const next = parseLine(lineTexts[lineNo] ?? "", lineNo, nextState, options);
    parsed[lineNo] = next.parsed;
    nextState = next.nextState;
  }
  return nextState;
}

function copySuffixLines(
  previous: ParsedDocumentEntry,
  parsed: ParsedLine[],
  lineTexts: string[],
  newSuffixStart: number,
): void {
  const delta = lineTexts.length - previous.lineTexts.length;
  for (let lineNo = newSuffixStart; lineNo < lineTexts.length; lineNo += 1) {
    parsed[lineNo] = cloneParsedLine(previous.parsed[lineNo - delta], lineNo);
  }
}

export function parseDocumentIncremental(
  previous: ParsedDocumentEntry,
  document: vscode.TextDocument,
  options?: ParseOptions,
): ParsedDocumentEntry {
  const lineTexts = lineTextsForDocument(document);
  const prevLineTexts = previous.lineTexts;
  const { prefixLines, suffixLines } = reuseWindow(prevLineTexts, lineTexts);

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
  state = parseDirtyRange(lineTexts, parsed, prefixLines, newSuffixStart, state, options);

  if (suffixLines > 0) {
    const expectedState = stateAfterLine(previous.parsed[oldSuffixStart - 1]);
    if (sameState(state, expectedState)) {
      copySuffixLines(previous, parsed, lineTexts, newSuffixStart);
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
    }
  }

  parseDirtyRange(lineTexts, parsed, newSuffixStart, lineTexts.length, state, options);
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
