import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema/types";

export interface ParsedSectionHeader {
  sectionType: string;
  name: string | null;
  fromIndex: number;
  profileName: string | null;
}

export function parseSectionHeader(
  line: ParsedLine,
  schema?: HaproxySchema,
): ParsedSectionHeader | null {
  if (!line.isSectionHeader || line.tokens.length === 0) {
    return null;
  }
  const sectionType = line.tokens[0].text.toLowerCase();
  const fromModifier = sectionHeaderFromModifier(schema);
  let name: string | null = null;
  let fromIndex = -1;
  let profileName: string | null = null;

  if (line.tokens[1] && line.tokens[1].text.toLowerCase() !== fromModifier) {
    name = line.tokens[1].text;
  }

  for (let i = 1; i < line.tokens.length; i += 1) {
    if (line.tokens[i].text.toLowerCase() === fromModifier) {
      fromIndex = i;
      profileName = line.tokens[i + 1]?.text ?? null;
      break;
    }
  }

  return { sectionType, name, fromIndex, profileName };
}

export function sectionHeaderFromModifier(schema?: HaproxySchema): string {
  if (schema) {
    const patterns = schema.reference_patterns ?? [];
    for (const pattern of patterns) {
      if (pattern.scope === "section-header" && pattern.match_tokens.length >= 3) {
        const modifier = pattern.match_tokens[2];
        if (modifier && modifier !== "*") {
          return modifier.toLowerCase();
        }
      }
    }
  }
  return "from";
}

export function sectionHeaderFromProfileTokenIndex(
  line: ParsedLine,
  schema?: HaproxySchema,
): number {
  const header = parseSectionHeader(line, schema);
  if (!header || header.fromIndex < 0) {
    return -1;
  }
  return header.fromIndex + 1;
}

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
  const leadingWs = lineText.length - lineText.trimStart().length;
  return leadingWs === 0 && character <= leadingWs;
}
