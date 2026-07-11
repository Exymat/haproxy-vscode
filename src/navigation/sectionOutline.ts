import * as vscode from "vscode";

import { ParsedLine } from "../parser";
import { isTopLevelSectionHeader } from "../language/sectionUtils";

export interface SectionSymbolInfo {
  name: string;
  detail: string;
  startLine: number;
  endLine: number;
  endColumn: number;
  selectionStart: number;
  selectionEnd: number;
}

function sectionSymbolFromEntry(
  entry: ParsedLine,
  endLine: number,
  endColumn: number,
): SectionSymbolInfo {
  const sectionType = entry.tokens[0].text.toLowerCase();
  const sectionName =
    entry.tokens.length > 1
      ? entry.tokens
          .slice(1)
          .map((token) => token.text)
          .join(" ")
      : undefined;
  const name = sectionName ? `${sectionType} ${sectionName}` : sectionType;

  return {
    name,
    detail: sectionType,
    startLine: entry.line,
    endLine: Math.max(entry.line, endLine),
    endColumn,
    selectionStart: entry.tokens[0].start,
    selectionEnd: entry.tokens[entry.tokens.length - 1].end,
  };
}

const sectionOutlineCache = new WeakMap<
  vscode.TextDocument,
  { version: number; lineCount: number; symbols: SectionSymbolInfo[] }
>();

export function getSectionOutline(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
): SectionSymbolInfo[] {
  const lineCount = document.lineCount;
  const hit = sectionOutlineCache.get(document);
  if (hit && hit.version === document.version && hit.lineCount === lineCount) {
    return hit.symbols;
  }
  const symbols = buildSectionSymbols(parsed, lineCount);
  sectionOutlineCache.set(document, { version: document.version, lineCount, symbols });
  return symbols;
}

export function buildSectionSymbols(parsed: ParsedLine[], lineCount: number): SectionSymbolInfo[] {
  const symbols: SectionSymbolInfo[] = [];
  let openIndex = -1;
  const lastLine = lineCount - 1;
  const lastColumn = parsed[lastLine]?.textLength ?? 0;

  for (let i = 0; i < parsed.length; i += 1) {
    const entry = parsed[i];
    if (!isTopLevelSectionHeader(entry)) {
      continue;
    }

    if (openIndex >= 0) {
      const closedEndLine = Math.max(symbols[openIndex].startLine, entry.line - 1);
      symbols[openIndex].endLine = closedEndLine;
      symbols[openIndex].endColumn = parsed[closedEndLine].textLength ?? 0;
    }

    symbols.push(sectionSymbolFromEntry(entry, lastLine, lastColumn));
    openIndex = symbols.length - 1;
  }

  return symbols;
}

export interface SectionFoldRange {
  startLine: number;
  endLine: number;
}

/** Fold ranges start at the section header; VS Code hides startLine+1..endLine when collapsed. */
export function buildSectionFoldRanges(sections: SectionSymbolInfo[]): SectionFoldRange[] {
  return sections
    .filter((section) => section.endLine > section.startLine)
    .map((section) => ({
      startLine: section.startLine,
      endLine: section.endLine,
    }));
}

export function sectionOutlineByStartLine(
  document: vscode.TextDocument,
  parsed: ParsedLine[],
): Map<number, SectionSymbolInfo> {
  return new Map(
    getSectionOutline(document, parsed).map((section) => [section.startLine, section]),
  );
}

export function sectionText(document: vscode.TextDocument, section: SectionSymbolInfo): string {
  const lines: string[] = [];
  for (let line = section.startLine; line <= section.endLine; line += 1) {
    lines.push(document.lineAt(line).text);
  }
  return lines.join("\n");
}
