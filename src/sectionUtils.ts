import { ParsedLine } from "./parser";

export function isTopLevelSectionHeader(entry: ParsedLine): boolean {
  return entry.isSectionHeader && entry.tokens.length > 0 && entry.tokens[0].start === 0;
}

export function isSectionHeaderCompletionContext(
  line: ParsedLine,
  tokenIndex: number,
  lineText: string,
  character: number,
): boolean {
  if (tokenIndex !== 0) {
    return false;
  }
  if (line.tokens.length > 0) {
    return line.tokens[0].start === 0;
  }
  /* v8 ignore next -- blank-line completion uses a whitespace-only fallback before the first token exists */
  const leadingWs = lineText.match(/^\s*/)?.[0].length ?? 0;
  return leadingWs === 0 && character <= leadingWs;
}
