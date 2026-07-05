import { ParsedLine } from "../parser";
import { findReferencePatternMatches } from "../referencePatternMatching";
import { isTopLevelSectionHeader } from "../sectionUtils";
import {
  HaproxySchema,
  ReferencePattern,
  sampleExpressionNameSets,
  StatementRule,
  symbolRecord,
  symbolStringList,
} from "../schema";
import { ruleMatchesLine } from "../statementLayout";

import {
  effectiveScopeKeyForSchema,
  proxyScopeKey,
  proxySectionSet,
  sectionDefinitionKinds,
  scopedSymbolKindSet,
  SymbolIndex,
  SymbolKind,
  SymbolSite,
} from "./types";
import { addSite, buildReferencesByKey, symbolNameTokenIndex } from "./utils";

function aclConditionOperators(schema: HaproxySchema): Set<string> {
  return new Set(symbolStringList(schema, "acl_condition_operators"));
}

function aclConditionIntroducer(schema: HaproxySchema, text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return lower === "if" || lower === "unless" || aclConditionOperators(schema).has(text);
}

function aclReferenceAt(
  schema: HaproxySchema,
  line: ParsedLine,
  tokenIndex: number,
): { name: string; tokenIndex: number; start: number; end: number } | null {
  const tokens = line.tokens;
  const token = tokens[tokenIndex];
  if (!token) {
    return null;
  }

  if (
    token.text === "{" ||
    token.text === "}" ||
    token.text === "!" ||
    aclConditionOperators(schema).has(token.text)
  ) {
    return null;
  }

  const prev = tokens[tokenIndex - 1]?.text;

  if (prev === "{" && sampleExpressionNameSets(schema).fetchNames.has(token.text.toLowerCase())) {
    return null;
  }

  if (aclConditionIntroducer(schema, prev) || prev === "{") {
    if (token.text.startsWith("!") && token.text.length > 1) {
      return { name: token.text.slice(1), tokenIndex, start: token.start + 1, end: token.end };
    }
    return { name: token.text, tokenIndex, start: token.start, end: token.end };
  }

  return null;
}

function pushReference(
  references: SymbolSite[],
  kind: SymbolKind,
  name: string,
  line: ParsedLine,
  tokenIndex: number,
  scopeKey: string | null,
): void {
  const token = line.tokens[tokenIndex];
  references.push({
    kind,
    name,
    line: line.line,
    start: token.start,
    end: token.end,
    scopeKey,
    role: "reference",
  });
}

function pushReferenceRange(
  references: SymbolSite[],
  kind: SymbolKind,
  name: string,
  line: ParsedLine,
  start: number,
  end: number,
  scopeKey: string | null,
): void {
  references.push({
    kind,
    name,
    line: line.line,
    start,
    end,
    scopeKey,
    role: "reference",
  });
}

const SAMPLE_FETCH_REF = /^([a-z_][\w.-]*)\(([^)]*)\)$/i;

interface FetchReferenceRule {
  reference_kind: string;
  argument_index?: number;
  scope?: string;
}

function fetchReferenceRules(schema: HaproxySchema): Record<string, FetchReferenceRule> {
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

function collectSampleFetchReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  schema: HaproxySchema,
): void {
  const rules = fetchReferenceRules(schema);
  for (let i = 0; i < line.tokens.length; i += 1) {
    const token = line.tokens[i];
    if (!token) {
      continue;
    }
    const match = SAMPLE_FETCH_REF.exec(token.text);
    if (!match) {
      continue;
    }
    const fetch = match[1].toLowerCase();
    const rule = rules[fetch];
    if (!rule) {
      continue;
    }
    const argIndex = rule.argument_index ?? 0;
    const rawArgs = match[2];
    const rawArg = rawArgs.split(",")[argIndex] ?? "";
    const arg = rawArg.trim();
    if (!arg) {
      continue;
    }
    const refScope = rule.scope === "section" ? scopeKey : null;
    const openParen = token.text.indexOf("(");
    const argParts = rawArgs.split(",");
    let rawArgStart = 0;
    for (let partIndex = 0; partIndex < argIndex; partIndex += 1) {
      rawArgStart += (argParts[partIndex]?.length ?? 0) + 1;
    }
    const trimOffset = rawArg.indexOf(arg);
    const start = token.start + openParen + 1 + rawArgStart + trimOffset;
    pushReferenceRange(
      references,
      rule.reference_kind as SymbolKind,
      arg,
      line,
      start,
      start + arg.length,
      refScope,
    );
  }
}

function collectFilterSelfReference(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  schema: HaproxySchema,
): void {
  if (!scopeKey || line.tokens.length < 2) {
    return;
  }
  const keyword = line.tokens[0]?.text.toLowerCase();
  const ruleRaw = symbolRecord(schema, "self_reference_keywords")[keyword];
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

function collectConfiguredReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  patterns: ReferencePattern[],
  schema: HaproxySchema,
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

  collectSampleFetchReferences(line, scopeKey, references, schema);
}

function collectAclReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  schema: HaproxySchema,
): void {
  if (!scopeKey) {
    return;
  }
  for (let i = 1; i < line.tokens.length; i += 1) {
    const hit = aclReferenceAt(schema, line, i);
    if (!hit) {
      continue;
    }
    references.push({
      kind: "acl",
      name: hit.name,
      line: line.line,
      start: hit.start,
      end: hit.end,
      scopeKey,
      role: "reference",
    });
  }
}

function collectSectionHeaderSites(
  line: ParsedLine,
  schema: HaproxySchema,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
): void {
  const sectionType = line.tokens[0].text.toLowerCase();
  const defKind = sectionDefinitionKinds(schema)[sectionType];
  if (!defKind || line.tokens.length < 2) {
    return;
  }

  const nameToken = line.tokens[1];
  const defSite: SymbolSite = {
    kind: defKind,
    name: nameToken.text,
    line: line.line,
    start: nameToken.start,
    end: nameToken.end,
    scopeKey: null,
    role: "definition",
  };
  addSite(schema, definitions, references, defSite);

  for (let i = 2; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() !== "from") {
      continue;
    }
    const refToken = line.tokens[i + 1];
    addSite(schema, definitions, references, {
      kind: "defaults-profile",
      name: refToken.text,
      line: line.line,
      start: refToken.start,
      end: refToken.end,
      scopeKey: null,
      role: "reference",
    });
  }
}

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

function collectStatementRuleSites(
  line: ParsedLine,
  schema: HaproxySchema,
  rules: StatementRule[],
  scopeKey: string | null,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
): void {
  if (line.isSectionHeader || line.tokens.length === 0) {
    return;
  }

  for (const rule of rules) {
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
          addSite(schema, definitions, references, site);
        }
      }
    }

    if (rule.reference_kind) {
      const idx = symbolNameTokenIndex(rule);
      if (idx !== null) {
        const token = line.tokens[idx];
        if (token) {
          const kind = rule.reference_kind as SymbolKind;
          const site = siteFromToken(
            kind,
            token.text,
            line,
            idx,
            effectiveScopeKeyForSchema(schema, kind, scopeKey),
            "reference",
          );
          addSite(schema, definitions, references, site);
        }
      }
    }
  }

  collectAclReferences(line, scopeKey, references, schema);
  collectFilterSelfReference(line, scopeKey, references, schema);
  collectConfiguredReferences(line, scopeKey, references, schema.reference_patterns ?? [], schema);
}

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

/** Collect definition/reference sites contributed by a single parsed line. */
export function collectLineSymbolSites(
  line: ParsedLine,
  schema: HaproxySchema,
  scopeKey: string | null,
): SymbolSite[] {
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const rules = schema.statement_rules ?? [];

  if (isTopLevelSectionHeader(line)) {
    collectSectionHeaderSites(line, schema, definitions, references);
  } else {
    collectStatementRuleSites(line, schema, rules, scopeKey, definitions, references);
  }

  const sites: SymbolSite[] = [...references];
  for (const defs of definitions.values()) {
    sites.push(...defs);
  }
  return sites;
}

/** Stable fingerprint of symbol names/roles on a line (ignores positions). */
export function symbolSiteFingerprint(sites: SymbolSite[]): string {
  if (sites.length === 0) {
    return "";
  }
  return sites
    .map((site) => `${site.role}:${site.kind}:${site.scopeKey ?? ""}:${site.name.toLowerCase()}`)
    .sort()
    .join("\0");
}

export function buildLineFingerprints(parsed: ParsedLine[], schema: HaproxySchema): string[] {
  const scopeKeyByLine = buildScopeKeyByLine(parsed, schema);
  return parsed.map((line) =>
    symbolSiteFingerprint(collectLineSymbolSites(line, schema, scopeKeyByLine[line.line] ?? null)),
  );
}

export function buildSymbolIndex(parsed: ParsedLine[], schema: HaproxySchema): SymbolIndex {
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const scopeKeyByLine = buildScopeKeyByLine(parsed, schema);

  for (const line of parsed) {
    const scopeKey = scopeKeyByLine[line.line] ?? null;
    for (const site of collectLineSymbolSites(line, schema, scopeKey)) {
      addSite(schema, definitions, references, site);
    }
  }

  return {
    definitions,
    references,
    referencesByKey: buildReferencesByKey(schema, references),
    scopeKeyByLine,
    scopedSymbolKinds: scopedSymbolKindSet(schema),
  };
}

/** Exported for resolve.ts ACL reference matching. */
export { aclReferenceAt };
