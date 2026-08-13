/** Parses and classifies HAProxy section headers and from-modifiers. */
import { ParsedLine } from "../parser";
import { symbolStringSet } from "../schema/symbols";
import { HaproxySchema } from "../schema/types";

export interface ParsedSectionHeader {
  sectionType: string;
  name: string | null;
  fromIndex: number;
  profileName: string | null;
}

function defaultsSectionName(schema?: HaproxySchema): string {
  if (schema && typeof schema.symbols?.defaults_section_name === "string") {
    return schema.symbols.defaults_section_name.toLowerCase();
  }
  return "defaults";
}

export function sectionHeaderSupportsFromModifier(
  schema: HaproxySchema | undefined,
  sectionType: string,
): boolean {
  if (!schema) {
    return ["frontend", "backend", "listen", "defaults"].includes(sectionType);
  }
  return (
    symbolStringSet(schema, "proxy_sections").has(sectionType) ||
    sectionType === defaultsSectionName(schema)
  );
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
  const defaultsSection = defaultsSectionName(schema);
  let name: string | null = null;
  let fromIndex = -1;
  let profileName: string | null = null;

  if (line.tokens.length === 1) {
    return { sectionType, name, fromIndex, profileName };
  }

  if (sectionType === defaultsSection && line.tokens[1].text.toLowerCase() === fromModifier) {
    fromIndex = 1;
    profileName = line.tokens[2]?.text ?? null;
    return { sectionType, name, fromIndex, profileName };
  }

  name = line.tokens[1].text;

  if (
    sectionHeaderSupportsFromModifier(schema, sectionType) &&
    line.tokens[2]?.text.toLowerCase() === fromModifier
  ) {
    fromIndex = 2;
    profileName = line.tokens[3]?.text ?? null;
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

/** True when the cursor is in the `from` slot of a from-capable section header. */
export function isSectionHeaderFromModifierCompletion(
  line: ParsedLine,
  tokenIndex: number,
  schema?: HaproxySchema,
): boolean {
  if (tokenIndex <= 0) {
    return false;
  }

  const header = parseSectionHeader(line, schema);
  if (!header || !sectionHeaderSupportsFromModifier(schema, header.sectionType)) {
    return false;
  }

  if (header.fromIndex >= 0 && tokenIndex > header.fromIndex) {
    return false;
  }

  const fromModifier = sectionHeaderFromModifier(schema);
  if (header.sectionType === defaultsSectionName(schema) && tokenIndex === 1) {
    const token = line.tokens[1];
    return !token || fromModifier.startsWith(token.text.toLowerCase());
  }

  return tokenIndex === 2;
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
