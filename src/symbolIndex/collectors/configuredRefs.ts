import { ParsedLine } from "../../parser";
import { findReferencePatternMatches } from "../../referencePatternMatching";
import { ReferencePattern } from "../../schema";

import { FetchReferenceRule } from "../context";
import { pushReference } from "../referenceHelpers";
import { SymbolKind, SymbolSite } from "../types";

import { collectSampleFetchReferences } from "./sampleFetch";

export function collectFilterSelfReference(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  selfReferenceKeywords: Record<string, unknown>,
): void {
  if (!scopeKey || line.tokens.length < 2) {
    return;
  }
  const keyword = line.tokens[0]?.text.toLowerCase();
  const ruleRaw = selfReferenceKeywords[keyword];
  if (!ruleRaw || typeof ruleRaw !== "object" || Array.isArray(ruleRaw)) {
    return;
  }
  const rule = ruleRaw as Record<string, unknown>;
  const tokenIndex = typeof rule.token_index === "number" ? rule.token_index : 1;
  const referenceKind = typeof rule.reference_kind === "string" ? rule.reference_kind : null;
  if (!referenceKind || !line.tokens[tokenIndex]) {
    return;
  }
  const refScope = rule.scope === "section" ? scopeKey : null;
  pushReference(
    references,
    referenceKind as SymbolKind,
    line.tokens[tokenIndex].text,
    line,
    tokenIndex,
    refScope,
  );
}

export function collectConfiguredReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  patterns: ReferencePattern[],
  fetchRules: Record<string, FetchReferenceRule>,
): void {
  for (const pattern of patterns) {
    for (const hit of findReferencePatternMatches(line.tokens, pattern)) {
      const targetScopeKey = pattern.scope === "section" ? scopeKey : null;
      const token = hit.targetToken;
      if (pattern.split) {
        const names = token.text.split(pattern.split);
        let offset = 0;
        for (const raw of names) {
          const name = raw.trim();
          if (!name) {
            offset += raw.length + pattern.split.length;
            continue;
          }
          const startCol = token.start + token.text.indexOf(name, offset);
          references.push({
            kind: pattern.reference_kind as SymbolKind,
            name,
            line: line.line,
            start: startCol,
            end: startCol + name.length,
            scopeKey: targetScopeKey,
            role: "reference",
          });
          offset = token.text.indexOf(name, offset) + name.length;
        }
      } else {
        references.push({
          kind: pattern.reference_kind as SymbolKind,
          name: token.text,
          line: line.line,
          start: token.start,
          end: token.end,
          scopeKey: targetScopeKey,
          role: "reference",
        });
      }
    }
  }

  collectSampleFetchReferences(line, scopeKey, references, fetchRules);
}
