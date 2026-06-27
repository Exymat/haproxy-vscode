import { ParsedLine } from "../parser";
import { findReferencePatternMatches } from "../referencePatternMatching";
import { isTopLevelSectionHeader } from "../sectionUtils";
import { HaproxySchema, ReferencePattern, StatementRule } from "../schema";
import { ruleMatchesLine } from "../statementLayout";

import {
  effectiveScopeKey,
  PROXY_SECTIONS,
  proxyScopeKey,
  SECTION_DEFINITION_KINDS,
  SymbolIndex,
  SymbolKind,
  SymbolSite,
} from "./types";
import { addSite, buildReferencesByKey, symbolNameTokenIndex } from "./utils";

const ACL_CONDITION_OPS = new Set(["&&", "||"]);

function aclConditionIntroducer(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return lower === "if" || lower === "unless" || ACL_CONDITION_OPS.has(text);
}

function aclReferenceAt(
  line: ParsedLine,
  tokenIndex: number,
): { name: string; tokenIndex: number } | null {
  const tokens = line.tokens;
  const token = tokens[tokenIndex];
  if (!token) {
    return null;
  }

  if (
    token.text === "{" ||
    token.text === "}" ||
    token.text === "!" ||
    ACL_CONDITION_OPS.has(token.text)
  ) {
    return null;
  }

  const prev = tokens[tokenIndex - 1]?.text;

  if (aclConditionIntroducer(prev) || prev === "{") {
    if (token.text.startsWith("!") && token.text.length > 1) {
      return { name: token.text.slice(1), tokenIndex };
    }
    return { name: token.text, tokenIndex };
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

const SAMPLE_FETCH_REF = /^([a-z_][\w.-]*)\(([^)]*)\)$/i;

function collectSampleFetchReferences(line: ParsedLine, references: SymbolSite[]): void {
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
    const arg = match[2].trim();
    if (!arg) {
      continue;
    }
    if (fetch === "http_auth" || fetch === "http_auth_group") {
      pushReference(references, "userlist", arg, line, i, null);
    }
  }
}

function collectFilterSelfReference(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
): void {
  if (!scopeKey || line.tokens.length < 2) {
    return;
  }
  const keyword = line.tokens[0]?.text.toLowerCase();
  if (keyword !== "filter") {
    return;
  }
  pushReference(references, "filter", line.tokens[1].text, line, 1, scopeKey);
}

function collectConfiguredReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  patterns: ReferencePattern[],
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

  collectSampleFetchReferences(line, references);
}

function collectAclReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
): void {
  if (!scopeKey) {
    return;
  }
  for (let i = 1; i < line.tokens.length; i += 1) {
    const hit = aclReferenceAt(line, i);
    if (!hit) {
      continue;
    }
    const token = line.tokens[hit.tokenIndex];
    references.push({
      kind: "acl",
      name: hit.name,
      line: line.line,
      start: token.start,
      end: token.end,
      scopeKey,
      role: "reference",
    });
  }
}

function collectSectionHeaderSites(
  line: ParsedLine,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
): void {
  const sectionType = line.tokens[0].text.toLowerCase();
  const defKind = SECTION_DEFINITION_KINDS[sectionType];
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
  addSite(definitions, references, defSite);

  for (let i = 2; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() !== "from") {
      continue;
    }
    const refToken = line.tokens[i + 1];
    addSite(definitions, references, {
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
          addSite(definitions, references, site);
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
            effectiveScopeKey(kind, scopeKey),
            "reference",
          );
          addSite(definitions, references, site);
        }
      }
    }
  }

  collectAclReferences(line, scopeKey, references);
  collectFilterSelfReference(line, scopeKey, references);
  collectConfiguredReferences(line, scopeKey, references, schema.reference_patterns ?? []);
}

export function buildScopeKeyByLine(parsed: ParsedLine[]): (string | null)[] {
  const scopeKeyByLine: (string | null)[] = Array.from({ length: parsed.length }, () => null);
  let currentScopeKey: string | null = null;

  for (const line of parsed) {
    if (isTopLevelSectionHeader(line) && line.tokens.length >= 2) {
      const sectionType = line.tokens[0].text.toLowerCase();
      currentScopeKey = PROXY_SECTIONS.has(sectionType)
        ? proxyScopeKey(sectionType, line.tokens[1].text)
        : null;
    } else if (isTopLevelSectionHeader(line)) {
      currentScopeKey = null;
    }
    scopeKeyByLine[line.line] = currentScopeKey;
  }

  return scopeKeyByLine;
}

export function buildSymbolIndex(parsed: ParsedLine[], schema: HaproxySchema): SymbolIndex {
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const rules = schema.statement_rules ?? [];
  const scopeKeyByLine = buildScopeKeyByLine(parsed);

  for (const line of parsed) {
    if (isTopLevelSectionHeader(line)) {
      collectSectionHeaderSites(line, definitions, references);
      continue;
    }

    const scopeKey = scopeKeyByLine[line.line] ?? null;
    collectStatementRuleSites(line, schema, rules, scopeKey, definitions, references);
  }

  return {
    definitions,
    references,
    referencesByKey: buildReferencesByKey(references),
    scopeKeyByLine,
  };
}

/** Exported for resolve.ts ACL reference matching. */
export { aclReferenceAt };
