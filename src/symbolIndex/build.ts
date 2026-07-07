import { isAclOnlyCriterion } from "../aclCondition";
import { ParsedLine } from "../parser";
import { findReferencePatternMatches } from "../referencePatternMatching";
import { isTopLevelSectionHeader } from "../sectionUtils";
import {
  HaproxySchema,
  keywordGroupSet,
  ReferencePattern,
  sampleExpressionNameSets,
  symbolRecord,
  symbolStringList,
} from "../schema";
import { ruleMatchesLine, candidateRules } from "../statementLayout";
import { isLikelyValue } from "../tokenUtils";

import {
  effectiveScopeKey,
  proxyScopeKey,
  proxySectionSet,
  sectionDefinitionKinds,
  scopedSymbolKindSet,
  SymbolIndex,
  SymbolKind,
  SymbolSite,
} from "./types";
import {
  addSite,
  buildReferencesByKey,
  buildSitesByLine,
  ensureSitesByLine,
  symbolNameTokenIndex,
} from "./utils";

function aclConditionOperators(schema: HaproxySchema): Set<string> {
  return new Set(symbolStringList(schema, "acl_condition_operators"));
}

function aclConditionIntroducer(
  schema: HaproxySchema,
  text: string,
  aclOperators: Set<string>,
): boolean {
  const lower = text.toLowerCase();
  return lower === "if" || lower === "unless" || aclOperators.has(text);
}

function isNegatedAclToken(text: string): boolean {
  return text.startsWith("!") && text.length > 1;
}

function isPlainAclNameToken(text: string): boolean {
  if (isNegatedAclToken(text)) {
    return true;
  }
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(text);
}

function braceDepthAt(
  tokens: ParsedLine["tokens"],
  tokenIndex: number,
  conditionStart: number,
): number {
  let depth = 0;
  for (let i = conditionStart; i < tokenIndex; i += 1) {
    const text = tokens[i]?.text;
    if (text === "{") {
      depth += 1;
    } else if (text === "}") {
      depth -= 1;
    }
  }
  return depth;
}

function aclReferenceContextAfterPrev(
  schema: HaproxySchema,
  prev: string | undefined,
  aclOperators: Set<string>,
  allowChainedReferences: boolean,
): boolean {
  if (!prev) {
    return false;
  }
  if (
    aclConditionIntroducer(schema, prev, aclOperators) ||
    prev === "{" ||
    prev === "}" ||
    prev === "!" ||
    prev === "(" ||
    prev === ")"
  ) {
    return true;
  }
  if (!allowChainedReferences) {
    return false;
  }
  return isPlainAclNameToken(prev);
}

function aclConditionStartIndex(tokens: ParsedLine["tokens"]): number | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const lower = tokens[i].text.toLowerCase();
    if (lower === "if" || lower === "unless") {
      return i + 1;
    }
  }
  return null;
}

function aclReferenceAt(
  schema: HaproxySchema,
  line: ParsedLine,
  tokenIndex: number,
  aclOperators: Set<string>,
  fetchNames: Set<string>,
  aclCriteria: Set<string>,
): { name: string; tokenIndex: number; start: number; end: number } | null {
  const tokens = line.tokens;
  const token = tokens[tokenIndex];
  if (!token) {
    return null;
  }

  const conditionStart = aclConditionStartIndex(tokens);
  if (conditionStart === null || tokenIndex < conditionStart) {
    return null;
  }

  if (
    token.text === "{" ||
    token.text === "}" ||
    token.text === "!" ||
    aclOperators.has(token.text)
  ) {
    return null;
  }

  const prev = tokens[tokenIndex - 1]?.text;
  const allowChainedReferences = braceDepthAt(tokens, tokenIndex, conditionStart) === 0;

  if (prev === "{" && fetchNames.has(token.text.toLowerCase())) {
    return null;
  }

  const fetchCall = SAMPLE_FETCH_REF.exec(token.text);
  if (prev === "{" && fetchCall && fetchNames.has(fetchCall[1].toLowerCase())) {
    return null;
  }

  if (
    prev === "{" &&
    isAclOnlyCriterion(token.text, aclCriteria, fetchNames, schema.sample_fetches ?? {})
  ) {
    return null;
  }

  if (!aclReferenceContextAfterPrev(schema, prev, aclOperators, allowChainedReferences)) {
    return null;
  }

  if (!isPlainAclNameToken(token.text)) {
    return null;
  }

  if (isNegatedAclToken(token.text)) {
    return { name: token.text.slice(1), tokenIndex, start: token.start + 1, end: token.end };
  }
  return { name: token.text, tokenIndex, start: token.start, end: token.end };
}

interface SymbolBuildContext {
  aclCriteria: Set<string>;
  aclOperators: Set<string>;
  fetchNames: Set<string>;
  fetchRules: Record<string, FetchReferenceRule>;
  selfReferenceKeywords: Record<string, unknown>;
  scopedSymbolKinds: Set<SymbolKind>;
}

function createSymbolBuildContext(schema: HaproxySchema): SymbolBuildContext {
  return {
    aclCriteria: keywordGroupSet(schema, "acl_criteria"),
    aclOperators: aclConditionOperators(schema),
    fetchNames: sampleExpressionNameSets(schema).fetchNames,
    fetchRules: fetchReferenceRules(schema),
    selfReferenceKeywords: symbolRecord(schema, "self_reference_keywords"),
    scopedSymbolKinds: scopedSymbolKindSet(schema),
  };
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
  rules: Record<string, FetchReferenceRule>,
): void {
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

function collectConfiguredReferences(
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

function collectAclReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  schema: HaproxySchema,
  aclOperators: Set<string>,
  fetchNames: Set<string>,
  aclCriteria: Set<string>,
): void {
  if (!scopeKey) {
    return;
  }
  for (let i = 1; i < line.tokens.length; i += 1) {
    const hit = aclReferenceAt(schema, line, i, aclOperators, fetchNames, aclCriteria);
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
  scopedSymbolKinds: Set<SymbolKind>,
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
  addSite(scopedSymbolKinds, definitions, references, defSite);

  for (let i = 2; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() !== "from") {
      continue;
    }
    const refToken = line.tokens[i + 1];
    addSite(scopedSymbolKinds, definitions, references, {
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

export interface SymbolIndexBuildOptions {
  /** When false, returns empty fingerprint slots without per-line hashing. */
  computeFingerprints?: boolean;
  /** When false, defers sitesByLine until navigation lookup. */
  buildSitesByLine?: boolean;
}

function collectLineSitesInto(
  line: ParsedLine,
  schema: HaproxySchema,
  scopeKey: string | null,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  context: SymbolBuildContext,
): void {
  if (isTopLevelSectionHeader(line)) {
    collectSectionHeaderSites(line, schema, definitions, references, context.scopedSymbolKinds);
    return;
  }
  collectStatementRuleSites(line, schema, scopeKey, definitions, references, context);
}

function updateScopeKeyForLine(
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

/** Collect definition/reference sites contributed by a single parsed line. */
export function collectLineSymbolSites(
  line: ParsedLine,
  schema: HaproxySchema,
  scopeKey: string | null,
  buildContext?: SymbolBuildContext,
): SymbolSite[] {
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const context = buildContext ?? createSymbolBuildContext(schema);

  collectLineSitesInto(line, schema, scopeKey, definitions, references, context);

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
  if (sites.length === 1) {
    const site = sites[0];
    return `${site.role}:${site.kind}:${site.scopeKey ?? ""}:${site.name.toLowerCase()}`;
  }
  const parts = sites.map(
    (site) => `${site.role}:${site.kind}:${site.scopeKey ?? ""}:${site.name.toLowerCase()}`,
  );
  parts.sort();
  return parts.join("\0");
}

export interface SymbolIndexBuildResult {
  index: SymbolIndex;
  lineFingerprints: string[];
}

function collectUnresolvedReferences(
  definitions: Map<string, SymbolSite[]>,
  referencesByKey: Map<string, SymbolSite[]>,
): SymbolSite[] {
  const unresolved: SymbolSite[] = [];

  for (const [key, refs] of referencesByKey) {
    if (definitions.has(key)) {
      continue;
    }
    unresolved.push(...refs);
  }

  return unresolved;
}

export function buildSymbolIndexWithFingerprints(
  parsed: ParsedLine[],
  schema: HaproxySchema,
  options: SymbolIndexBuildOptions = {},
): SymbolIndexBuildResult {
  const computeFingerprints = options.computeFingerprints !== false;
  const buildSitesByLineNow = options.buildSitesByLine !== false;
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const lineFingerprints: string[] = Array.from({ length: parsed.length }, () => "");
  const scopeKeyByLine: (string | null)[] = Array.from({ length: parsed.length }, () => null);
  const buildContext = createSymbolBuildContext(schema);
  const proxySections = proxySectionSet(schema);
  const scopeState = { currentScopeKey: null as string | null };

  for (const line of parsed) {
    const scopeKey = updateScopeKeyForLine(line, proxySections, scopeState);
    scopeKeyByLine[line.line] = scopeKey;

    if (computeFingerprints) {
      const sites = collectLineSymbolSites(line, schema, scopeKey, buildContext);
      lineFingerprints[line.line] = symbolSiteFingerprint(sites);
      for (const site of sites) {
        addSite(buildContext.scopedSymbolKinds, definitions, references, site);
      }
      continue;
    }

    collectLineSitesInto(line, schema, scopeKey, definitions, references, buildContext);
  }

  const referencesByKey = buildReferencesByKey(buildContext.scopedSymbolKinds, references);

  const index: SymbolIndex = {
    definitions,
    references,
    referencesByKey,
    scopeKeyByLine,
    scopedSymbolKinds: buildContext.scopedSymbolKinds,
    sitesByLine: buildSitesByLineNow
      ? buildSitesByLine(parsed.length, definitions, references)
      : [],
    unresolvedReferences: collectUnresolvedReferences(definitions, referencesByKey),
  };

  return { index, lineFingerprints };
}

export function buildLineFingerprints(parsed: ParsedLine[], schema: HaproxySchema): string[] {
  return buildSymbolIndexWithFingerprints(parsed, schema).lineFingerprints;
}

export function buildSymbolIndex(parsed: ParsedLine[], schema: HaproxySchema): SymbolIndex {
  return buildSymbolIndexWithFingerprints(parsed, schema).index;
}

export function patchSymbolIndexLine(
  index: SymbolIndex,
  line: ParsedLine,
  sites: SymbolSite[],
  buildContext: SymbolBuildContext,
): SymbolIndexBuildResult {
  const definitions = new Map<string, SymbolSite[]>();
  for (const [key, defs] of index.definitions) {
    const filtered = defs.filter((entry) => entry.line !== line.line);
    if (filtered.length > 0) {
      definitions.set(key, filtered);
    }
  }

  const references = index.references.filter((entry) => entry.line !== line.line);
  ensureSitesByLine(index);
  const sitesByLine = index.sitesByLine.slice();

  for (const site of sites) {
    addSite(buildContext.scopedSymbolKinds, definitions, references, site);
  }
  sitesByLine[line.line] = [...sites];

  const referencesByKey = buildReferencesByKey(buildContext.scopedSymbolKinds, references);

  const patched: SymbolIndex = {
    definitions,
    references,
    referencesByKey,
    scopeKeyByLine: index.scopeKeyByLine,
    scopedSymbolKinds: buildContext.scopedSymbolKinds,
    sitesByLine,
    unresolvedReferences: collectUnresolvedReferences(definitions, referencesByKey),
  };

  return { index: patched, lineFingerprints: [symbolSiteFingerprint(sites)] };
}

/** Exported for resolve.ts ACL reference matching. */
export { aclReferenceAt, createSymbolBuildContext };
