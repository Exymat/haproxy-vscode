import { ParsedLine } from "../parser";
import { isTopLevelSectionHeader } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";

import { proxyScopeKey, proxySectionSet } from "./types";

export function buildScopeKeyByLine(
  parsed: ParsedLine[],
  schema: HaproxySchema,
): (string | null)[] {
  const scopeKeyByLine: (string | null)[] = Array.from({ length: parsed.length }, () => null);
  let currentScopeKey: string | null = null;
  const proxySections = proxySectionSet(schema);

  for (const line of parsed) {
    if (isTopLevelSectionHeader(line) && line.tokens.length >= 2) {
      const sectionType = line.tokens[0].text.toLowerCase();
      currentScopeKey = proxySections.has(sectionType)
        ? proxyScopeKey(sectionType, line.tokens[1].text)
        : null;
    } else if (isTopLevelSectionHeader(line)) {
      currentScopeKey = null;
    }
    scopeKeyByLine[line.line] = currentScopeKey;
  }

  return scopeKeyByLine;
}

export function updateScopeKeyForLine(
  line: ParsedLine,
  proxySections: Set<string>,
  state: { currentScopeKey: string | null },
): string | null {
  if (isTopLevelSectionHeader(line) && line.tokens.length >= 2) {
    const sectionType = line.tokens[0].text.toLowerCase();
    state.currentScopeKey = proxySections.has(sectionType)
      ? proxyScopeKey(sectionType, line.tokens[1].text)
      : null;
  } else if (isTopLevelSectionHeader(line)) {
    state.currentScopeKey = null;
  }
  return state.currentScopeKey;
}
