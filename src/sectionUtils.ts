import { ParsedLine } from "./parser";

export function isTopLevelSectionHeader(entry: ParsedLine): boolean {
  return entry.isSectionHeader && entry.tokens.length > 0 && entry.tokens[0].start === 0;
}
