import { ParsedLine } from "../../parser";
import { HaproxySchema } from "../../schema";
import { ruleMatchesLine, candidateRules } from "../../statementLayout";
import { isLikelyValue } from "../../tokenUtils";

import { collectAclReferences } from "../aclReferences";
import { SymbolBuildContext } from "../context";
import { effectiveScopeKey, SymbolKind, SymbolSite } from "../types";
import { addSite, symbolNameTokenIndex } from "../utils";

import { collectConfiguredReferences, collectFilterSelfReference } from "./configuredRefs";
import { collectEnvironmentVariableSites } from "./environmentVars";

function siteFromToken(
  kind: SymbolKind,
  name: string,
  line: ParsedLine,
  tokenIndex: number,
  scopeKey: string | null,
  role: "definition" | "reference",
): SymbolSite {
  const token = line.tokens[tokenIndex];
  return {
    kind,
    name,
    line: line.line,
    start: token.start,
    end: token.end,
    scopeKey,
    role,
  };
}

export function collectStatementRuleSites(
  line: ParsedLine,
  schema: HaproxySchema,
  scopeKey: string | null,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  context: SymbolBuildContext,
): void {
  if (line.isSectionHeader || line.tokens.length === 0) {
    return;
  }

  for (const rule of candidateRules(schema, line)) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }

    if (rule.definition_kind) {
      const idx = symbolNameTokenIndex(rule);
      if (idx !== null) {
        const token = line.tokens[idx];
        if (token) {
          const kind = rule.definition_kind as SymbolKind;
          const site = siteFromToken(kind, token.text, line, idx, scopeKey, "definition");
          addSite(context.scopedSymbolKinds, definitions, references, site);
        }
      }
    }

    if (rule.reference_kind) {
      const idx = symbolNameTokenIndex(rule);
      if (idx !== null) {
        const token = line.tokens[idx];
        if (token && !isLikelyValue(token.text)) {
          const kind = rule.reference_kind as SymbolKind;
          const site = siteFromToken(
            kind,
            token.text,
            line,
            idx,
            effectiveScopeKey(context.scopedSymbolKinds, kind, scopeKey),
            "reference",
          );
          addSite(context.scopedSymbolKinds, definitions, references, site);
        }
      }
    }
  }

  collectAclReferences(
    line,
    scopeKey,
    references,
    schema,
    context.aclOperators,
    context.fetchNames,
    context.aclCriteria,
  );
  collectFilterSelfReference(line, scopeKey, references, context.selfReferenceKeywords);
  collectConfiguredReferences(
    line,
    scopeKey,
    references,
    schema.reference_patterns ?? [],
    context.fetchRules,
  );
  collectEnvironmentVariableSites(line, definitions, references, context.scopedSymbolKinds);
}
