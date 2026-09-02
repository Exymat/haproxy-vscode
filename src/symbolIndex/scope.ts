/** Computes per-line proxy scope keys from section headers. */
import { ParsedLine } from "../parser";
import { isTopLevelSectionHeader } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";

import { proxyScopeKey, proxySectionSet } from "./types";

export function buildScopeKeyByLine(
  parsed: ParsedLine[],
  schema: HaproxySchema,
): (string | null)[] {
  const scopeKeyByLine: (string | null)[] = Array.from({ length: parsed.length }, () => null);
  const proxySections = proxySectionSet(schema);
  const state = { currentScopeKey: null as string | null };
  for (const line of parsed) {
    scopeKeyByLine[line.line] = updateScopeKeyForLine(line, proxySections, state);
  }
  return scopeKeyByLine;
}

export function scopeKeyAtLine(
  parsed: ParsedLine[],
  lineNo: number,
  schema: HaproxySchema,
  scopeKeyByLine?: (string | null)[],
): string | null {
  if (scopeKeyByLine) {
    return scopeKeyByLine[lineNo] ?? null;
  }
  const proxySections = proxySectionSet(schema);
  for (let i = Math.min(lineNo, parsed.length - 1); i >= 0; i -= 1) {
    const line = parsed[i];
    if (!line || !isTopLevelSectionHeader(line)) {
      continue;
    }
    return updateScopeKeyForLine(line, proxySections, { currentScopeKey: null });
  }
  return null;
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
