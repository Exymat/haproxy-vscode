import { HaproxySchema } from "../schema/types";
import { symbolRecord, symbolStringList } from "../schema/symbols";
import { keywordGroupSet } from "../schema/keywords";
import { sampleExpressionNameSets } from "../schema/tokens";

import { scopedSymbolKindSet, SymbolKind } from "./types";

export interface FetchReferenceRule {
  reference_kind: string;
  argument_index?: number;
  scope?: string;
}

export interface SymbolBuildContext {
  aclCriteria: Set<string>;
  aclOperators: Set<string>;
  fetchNames: Set<string>;
  fetchRules: Record<string, FetchReferenceRule>;
  selfReferenceKeywords: Record<string, unknown>;
  scopedSymbolKinds: Set<SymbolKind>;
}

function aclConditionOperators(schema: HaproxySchema): Set<string> {
  return new Set(symbolStringList(schema, "acl_condition_operators"));
}

export function fetchReferenceRules(schema: HaproxySchema): Record<string, FetchReferenceRule> {
  const raw = symbolRecord(schema, "sample_fetch_references");
  const result: Record<string, FetchReferenceRule> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const rule = value as Record<string, unknown>;
    if (typeof rule.reference_kind === "string") {
      result[name] = {
        reference_kind: rule.reference_kind,
        argument_index: typeof rule.argument_index === "number" ? rule.argument_index : undefined,
        scope: typeof rule.scope === "string" ? rule.scope : undefined,
      };
    }
  }
  return result;
}

export function createSymbolBuildContext(schema: HaproxySchema): SymbolBuildContext {
  return {
    aclCriteria: keywordGroupSet(schema, "acl_criteria"),
    aclOperators: aclConditionOperators(schema),
    fetchNames: sampleExpressionNameSets(schema).fetchNames,
    fetchRules: fetchReferenceRules(schema),
    selfReferenceKeywords: symbolRecord(schema, "self_reference_keywords"),
    scopedSymbolKinds: scopedSymbolKindSet(schema),
  };
}
