import { ParsedLine } from "./parser";

export interface SectionSymbolInfo {
  name: string;
  detail: string;
  startLine: number;
  endLine: number;
  selectionStart: number;
  selectionEnd: number;
}

function isTopLevelSectionHeader(entry: ParsedLine): boolean {
  return entry.isSectionHeader && entry.tokens.length > 0 && entry.tokens[0].start === 0;
}

export function buildSectionSymbols(parsed: ParsedLine[], lineCount: number): SectionSymbolInfo[] {
  const symbols: SectionSymbolInfo[] = [];

  for (let i = 0; i < parsed.length; i += 1) {
    const entry = parsed[i];
    if (!isTopLevelSectionHeader(entry)) {
      continue;
    }

    const sectionType = entry.tokens[0].text.toLowerCase();
    const sectionName =
      entry.tokens.length > 1
        ? entry.tokens
            .slice(1)
            .map((token) => token.text)
            .join(" ")
        : undefined;
    const name = sectionName ? `${sectionType} ${sectionName}` : sectionType;

    let endLine = lineCount - 1;
    for (let j = i + 1; j < parsed.length; j += 1) {
      if (isTopLevelSectionHeader(parsed[j])) {
        endLine = parsed[j].line - 1;
        break;
      }
    }

    symbols.push({
      name,
      detail: sectionType,
      startLine: entry.line,
      endLine: Math.max(entry.line, endLine),
      selectionStart: entry.tokens[0].start,
      selectionEnd: entry.tokens[entry.tokens.length - 1].end,
    });
  }

  return symbols;
}

export interface SectionFoldRange {
  startLine: number;
  endLine: number;
}

/** Fold ranges start at the section header; VS Code hides startLine+1..endLine when collapsed. */
export function buildSectionFoldRanges(
  parsed: ParsedLine[],
  lineCount: number,
): SectionFoldRange[] {
  return buildSectionSymbols(parsed, lineCount)
    .filter((section) => section.endLine > section.startLine)
    .map((section) => ({
      startLine: section.startLine,
      endLine: section.endLine,
    }));
}
