import { ParsedLine } from "../../parser";
import { isEnvironmentVariableName } from "../../core/environmentVariables";
import { HaproxySchema } from "../../schema/types";
import { ruleMatchesLine, candidateRules } from "../../formatting/statementLayout";
import { isLikelyValue } from "../../parser/tokenUtils";

import { collectAclReferences } from "../aclReferences";
import { SymbolBuildContext } from "../context";
import { effectiveScopeKey, SymbolKind, SymbolSite } from "../types";
import { addSite, symbolNameTokenIndices } from "../utils";

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

function isValidSymbolNameToken(kind: SymbolKind, tokenText: string): boolean {
  if (kind === "environment-variable") {
    return isEnvironmentVariableName(tokenText);
  }
  return !isLikelyValue(tokenText);
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
      for (const idx of symbolNameTokenIndices(rule, line.tokens.length)) {
        const token = line.tokens[idx];
        if (!token || !isValidSymbolNameToken(rule.definition_kind, token.text)) {
          continue;
        }
        const kind = rule.definition_kind;
        const site = siteFromToken(kind, token.text, line, idx, scopeKey, "definition");
        addSite(context.scopedSymbolKinds, definitions, references, site);
      }
    }

    if (rule.reference_kind) {
      for (const idx of symbolNameTokenIndices(rule, line.tokens.length)) {
        const token = line.tokens[idx];
        if (!token || !isValidSymbolNameToken(rule.reference_kind, token.text)) {
          continue;
        }
        const kind = rule.reference_kind;
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
  collectEnvironmentVariableSites(line, references);
}
