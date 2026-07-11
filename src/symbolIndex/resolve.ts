import * as vscode from "vscode";

import {
  findEnvironmentVariableReferences,
  isEnvironmentVariableName,
} from "../core/environmentVariables";
import { getParsedDocument } from "../parser/parseCache";
import { ParsedLine } from "../parser";
import { findReferencePatternAtToken } from "../parser/referencePatternMatching";
import {
  isTopLevelSectionHeader,
  parseSectionHeader,
  sectionHeaderFromProfileTokenIndex,
} from "../language/sectionUtils";
import { HaproxySchema, StatementRule } from "../schema/types";
import { symbolStringList } from "../schema/symbols";
import { keywordGroupSet } from "../schema/keywords";
import { sectionHeaderSet } from "../schema/layout";
import { sampleExpressionNameSets } from "../schema/tokens";
import { ruleMatchesLine } from "../formatting/statementLayout";
import { tokenIndexAtPosition, isLikelyValue } from "../parser/tokenUtils";

import { aclReferenceAt } from "./aclReferences";
import { buildScopeKeyByLine } from "./scope";
import { symbolNameTokenIndices, ensureSitesByLine } from "./utils";
import {
  effectiveScopeKeyForSchema,
  sectionDefinitionKinds,
  symbolKeyForScopedKinds,
  SymbolIndex,
  SymbolKind,
  SymbolSite,
} from "./types";

function scopeKeyForLine(
  lineNo: number,
  scopeKeyByLine: (string | null)[] | undefined,
  parsed: ParsedLine[],
  schema: HaproxySchema,
): string | null {
  if (scopeKeyByLine) {
    return scopeKeyByLine[lineNo] ?? null;
  }
  return buildScopeKeyByLine(parsed, schema)[lineNo] ?? null;
}

function resolveSectionHeaderSymbol(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  if (!isTopLevelSectionHeader(line) || line.tokens.length < 2) {
    return null;
  }

  const header = parseSectionHeader(line, schema)!;

  const defKind = sectionDefinitionKinds(schema)[header.sectionType];
  if (!defKind) {
    return null;
  }

  if (tokenIndex === 1) {
    return { kind: defKind, name: line.tokens[1].text, scopeKey: null };
  }

  const profileIndex = sectionHeaderFromProfileTokenIndex(line, schema);
  if (profileIndex >= 0 && tokenIndex === profileIndex) {
    return { kind: "defaults-profile", name: line.tokens[profileIndex].text, scopeKey: null };
  }

  return null;
}

function resolveStatementRuleSymbol(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
  rules: StatementRule[],
  scopeKey: string | null,
  positionCharacter: number,
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  const envSymbol = resolveEnvironmentVariableSymbol(line, tokenIndex, positionCharacter);
  if (envSymbol) {
    return envSymbol;
  }

  for (const rule of rules) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }

    if (rule.definition_kind) {
      for (const idx of symbolNameTokenIndices(rule, line.tokens.length)) {
        if (idx !== tokenIndex) {
          continue;
        }
        const token = line.tokens[idx];
        if (
          rule.definition_kind === "environment-variable" &&
          !isEnvironmentVariableName(token.text)
        ) {
          continue;
        }
        return {
          kind: rule.definition_kind,
          name: token.text,
          scopeKey,
        };
      }
    }

    if (rule.reference_kind) {
      for (const idx of symbolNameTokenIndices(rule, line.tokens.length)) {
        if (idx !== tokenIndex) {
          continue;
        }
        const token = line.tokens[idx];
        const kind = rule.reference_kind;
        if (kind === "environment-variable" && !isEnvironmentVariableName(token.text)) {
          continue;
        }
        if (kind !== "environment-variable" && isLikelyValue(token.text)) {
          continue;
        }
        return {
          kind,
          name: token.text,
          scopeKey: effectiveScopeKeyForSchema(schema, kind, scopeKey),
        };
      }
    }
  }

  if (scopeKey) {
    const aclOperators = new Set(symbolStringList(schema, "acl_condition_operators"));
    const fetchNames = sampleExpressionNameSets(schema).fetchNames;
    const aclCriteria = keywordGroupSet(schema, "acl_criteria");
    const hit = aclReferenceAt(schema, line, tokenIndex, aclOperators, fetchNames, aclCriteria);
    if (hit) {
      return { kind: "acl", name: hit.name, scopeKey };
    }
  }

  for (const pattern of schema.reference_patterns ?? []) {
    const hit = findReferencePatternAtToken(line.tokens, pattern, tokenIndex);
    if (hit) {
      return {
        kind: pattern.reference_kind,
        name: hit.targetToken.text,
        scopeKey: pattern.scope === "section" ? scopeKey : null,
      };
    }
  }

  return null;
}

function resolveEnvironmentVariableSymbol(
  line: ParsedLine,
  tokenIndex: number,
  positionCharacter: number,
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  const token = line.tokens[tokenIndex];

  for (const hit of findEnvironmentVariableReferences(token)) {
    if (positionCharacter >= hit.start && positionCharacter <= hit.end) {
      return { kind: "environment-variable", name: hit.name, scopeKey: null };
    }
  }

  return null;
}

export function resolveSymbolAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  scopeKeyByLine?: (string | null)[],
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  const parsed = getParsedDocument(document, { sectionHeaders: sectionHeaderSet(schema) });
  const line = parsed[position.line];
  if (!line || line.tokens.length === 0) {
    return null;
  }

  const tokenIndex = tokenIndexAtPosition(line, position.character);
  if (tokenIndex === null) {
    return null;
  }

  if (line.isSectionHeader) {
    return resolveSectionHeaderSymbol(line, tokenIndex, schema);
  }

  const scopeKey = scopeKeyForLine(position.line, scopeKeyByLine, parsed, schema);

  return resolveStatementRuleSymbol(
    line,
    tokenIndex,
    schema,
    schema.statement_rules ?? [],
    scopeKey,
    position.character,
  );
}

export function findDefinitions(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): SymbolSite[] {
  return (
    index.definitions.get(symbolKeyForScopedKinds(index.scopedSymbolKinds, kind, name, scopeKey)) ??
    []
  );
}

export function findReferences(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): SymbolSite[] {
  const key = symbolKeyForScopedKinds(index.scopedSymbolKinds, kind, name, scopeKey);
  const refs = index.referencesByKey.get(key);
  if (refs) {
    return refs;
  }
  return [];
}

export function hasReferences(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): boolean {
  return index.referencesByKey.has(
    symbolKeyForScopedKinds(index.scopedSymbolKinds, kind, name, scopeKey),
  );
}

export function findAllSites(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): SymbolSite[] {
  const defs = findDefinitions(index, kind, name, scopeKey);
  const refs = findReferences(index, kind, name, scopeKey);
  return [...defs, ...refs];
}

function siteContainsPosition(site: SymbolSite, position: vscode.Position): boolean {
  return (
    site.line === position.line &&
    position.character >= site.start &&
    position.character <= site.end
  );
}

export function findSiteAtPosition(
  index: SymbolIndex,
  position: vscode.Position,
): SymbolSite | null {
  ensureSitesByLine(index);
  const lineSites = index.sitesByLine[position.line];
  if (!lineSites || lineSites.length === 0) {
    return null;
  }

  let best: SymbolSite | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const site of lineSites) {
    if (!siteContainsPosition(site, position)) {
      continue;
    }
    const span = site.end - site.start;
    if (span < bestSpan) {
      bestSpan = span;
      best = site;
    }
  }
  return best;
}
