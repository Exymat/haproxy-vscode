/** Resolves symbol definitions and references at a document position. */
import * as vscode from "vscode";

import {
  findEnvironmentVariableReferences,
  isEnvironmentVariableName,
} from "../core/environmentVariables";
import {
  findRuntimeVariableHits,
  findUnparenthesizedRuntimeVariable,
} from "../core/runtimeVariables";
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
import { ruleMatchesLine } from "../schema/statementLayout";
import { tokenIndexAtPosition, isLikelyValue } from "../parser/tokenUtils";

import { aclReferenceAt } from "./aclReferences";
import { scopeKeyAtLine } from "./scope";
import { symbolNameTokenIndices, ensureSitesByLine } from "./utils";
import {
  effectiveScopeKeyForSchema,
  proxyCapabilitiesForReference,
  proxyCapabilitiesForSectionType,
  sectionDefinitionKinds,
  siteMatchesProxyCapabilities,
  symbolKeyForScopedKinds,
  ProxyCapability,
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
  return scopeKeyAtLine(parsed, lineNo, schema, scopeKeyByLine);
}

function resolveSectionHeaderSymbol(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
): {
  kind: SymbolKind;
  name: string;
  scopeKey: string | null;
  proxyCapabilities?: readonly ProxyCapability[];
} | null {
  if (!isTopLevelSectionHeader(line) || line.tokens.length < 2) {
    return null;
  }

  const header = parseSectionHeader(line, schema)!;

  const defKind = sectionDefinitionKinds(schema)[header.sectionType];
  if (!defKind) {
    return null;
  }

  if (tokenIndex === 1) {
    return {
      kind: defKind,
      name: line.tokens[1].text,
      scopeKey: null,
      proxyCapabilities: proxyCapabilitiesForSectionType(header.sectionType),
    };
  }

  const profileIndex = sectionHeaderFromProfileTokenIndex(line, schema);
  if (profileIndex >= 0 && tokenIndex === profileIndex) {
    return { kind: "defaults-profile", name: line.tokens[profileIndex].text, scopeKey: null };
  }

  return null;
}

type ResolvedSymbol = {
  kind: SymbolKind;
  name: string;
  scopeKey: string | null;
  proxyCapabilities?: readonly ProxyCapability[];
};

function resolveRuleDefinition(
  rule: StatementRule,
  line: ParsedLine,
  tokenIndex: number,
  scopeKey: string | null,
): ResolvedSymbol | null {
  if (!rule.definition_kind) {
    return null;
  }
  for (const idx of symbolNameTokenIndices(rule, line.tokens.length)) {
    if (idx !== tokenIndex) {
      continue;
    }
    const token = line.tokens[idx];
    if (rule.definition_kind === "environment-variable" && !isEnvironmentVariableName(token.text)) {
      continue;
    }
    return {
      kind: rule.definition_kind,
      name: token.text,
      scopeKey,
    };
  }
  return null;
}

function resolveRuleReference(
  rule: StatementRule,
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
  scopeKey: string | null,
): ResolvedSymbol | null {
  if (!rule.reference_kind) {
    return null;
  }
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
      proxyCapabilities: proxyCapabilitiesForReference(kind, line.tokens[0]?.text),
    };
  }
  return null;
}

function resolveAclOrPatternSymbol(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
  scopeKey: string | null,
): ResolvedSymbol | null {
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

function resolveStatementRuleSymbol(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
  rules: StatementRule[],
  scopeKey: string | null,
  positionCharacter: number,
): ResolvedSymbol | null {
  const envSymbol = resolveEnvironmentVariableSymbol(line, tokenIndex, positionCharacter);
  if (envSymbol) {
    return envSymbol;
  }
  const runtimeVar = resolveRuntimeVariableSymbol(line, tokenIndex, positionCharacter);
  if (runtimeVar) {
    return runtimeVar;
  }

  for (const rule of rules) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }
    const definition = resolveRuleDefinition(rule, line, tokenIndex, scopeKey);
    if (definition) {
      return definition;
    }
    const reference = resolveRuleReference(rule, line, tokenIndex, schema, scopeKey);
    if (reference) {
      return reference;
    }
  }

  return resolveAclOrPatternSymbol(line, tokenIndex, schema, scopeKey);
}

function resolveRuntimeVariableSymbol(
  line: ParsedLine,
  tokenIndex: number,
  positionCharacter: number,
): {
  kind: SymbolKind;
  name: string;
  scopeKey: string | null;
  proxyCapabilities?: readonly ProxyCapability[];
} | null {
  const token = line.tokens[tokenIndex];
  if (token) {
    for (const hit of findRuntimeVariableHits(token)) {
      if (positionCharacter >= hit.start && positionCharacter <= hit.end) {
        return { kind: "variable", name: hit.name, scopeKey: null };
      }
    }
  }

  const unparenthesized = findUnparenthesizedRuntimeVariable(line);
  if (!unparenthesized) {
    return null;
  }
  const nameToken = line.tokens[tokenIndex];
  if (
    nameToken &&
    positionCharacter >= unparenthesized.start &&
    positionCharacter <= unparenthesized.end &&
    nameToken.start === unparenthesized.start
  ) {
    return { kind: "variable", name: unparenthesized.name, scopeKey: null };
  }
  return null;
}

function resolveEnvironmentVariableSymbol(
  line: ParsedLine,
  tokenIndex: number,
  positionCharacter: number,
): {
  kind: SymbolKind;
  name: string;
  scopeKey: string | null;
  proxyCapabilities?: readonly ProxyCapability[];
} | null {
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
): {
  kind: SymbolKind;
  name: string;
  scopeKey: string | null;
  proxyCapabilities?: readonly ProxyCapability[];
} | null {
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
  proxyCapabilities?: readonly ProxyCapability[],
): SymbolSite[] {
  const definitions =
    index.definitions.get(symbolKeyForScopedKinds(index.scopedSymbolKinds, kind, name, scopeKey)) ??
    [];
  return definitions.filter((site) => siteMatchesProxyCapabilities(site, proxyCapabilities));
}

export function findReferences(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
  proxyCapabilities?: readonly ProxyCapability[],
): SymbolSite[] {
  const key = symbolKeyForScopedKinds(index.scopedSymbolKinds, kind, name, scopeKey);
  const refs = index.referencesByKey.get(key);
  if (refs) {
    return refs.filter((site) => siteMatchesProxyCapabilities(site, proxyCapabilities));
  }
  return [];
}

export function hasReferences(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
  proxyCapabilities?: readonly ProxyCapability[],
): boolean {
  const key = symbolKeyForScopedKinds(index.scopedSymbolKinds, kind, name, scopeKey);
  const refs = index.referencesByKey.get(key);
  return Boolean(refs?.some((site) => siteMatchesProxyCapabilities(site, proxyCapabilities)));
}

export function findAllSites(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
  proxyCapabilities?: readonly ProxyCapability[],
): SymbolSite[] {
  const defs = findDefinitions(index, kind, name, scopeKey, proxyCapabilities);
  const refs = findReferences(index, kind, name, scopeKey, proxyCapabilities);
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
