import * as vscode from "vscode";

import { getParsedDocument } from "../parseCache";
import { ParsedLine } from "../parser";
import { isTopLevelSectionHeader } from "../sectionUtils";
import { HaproxySchema, StatementRule } from "../schema";
import { ruleMatchesLine } from "../statementLayout";

export type SymbolKind =
  | "proxy-section"
  | "defaults-profile"
  | "server"
  | "acl"
  | "filter"
  | "cache"
  | "userlist"
  | "resolvers"
  | "peers";

export interface SymbolSite {
  kind: SymbolKind;
  name: string;
  line: number;
  start: number;
  end: number;
  scopeKey: string | null;
  role: "definition" | "reference";
}

export interface SymbolIndex {
  definitions: Map<string, SymbolSite[]>;
  references: SymbolSite[];
  referencesByKey: Map<string, SymbolSite[]>;
  scopeKeyByLine: (string | null)[];
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

const PROXY_SECTIONS = new Set(["frontend", "backend", "listen"]);

const SECTION_DEFINITION_KINDS: Record<string, SymbolKind> = {
  frontend: "proxy-section",
  backend: "proxy-section",
  listen: "proxy-section",
  defaults: "defaults-profile",
  cache: "cache",
  userlist: "userlist",
  resolvers: "resolvers",
  peers: "peers",
};

const SCOPED_SYMBOL_KINDS = new Set<SymbolKind>(["server", "acl", "filter"]);

function effectiveScopeKey(kind: SymbolKind, scopeKey: string | null): string | null {
  return SCOPED_SYMBOL_KINDS.has(kind) ? scopeKey : null;
}

const indexCache = new WeakMap<vscode.TextDocument, { version: number; index: SymbolIndex }>();

export function symbolKey(kind: SymbolKind, name: string, scopeKey: string | null): string {
  const lower = name.toLowerCase();
  if (scopeKey && SCOPED_SYMBOL_KINDS.has(kind)) {
    return `${kind}:${scopeKey}:${lower}`;
  }
  return `${kind}:${lower}`;
}

function symbolNameTokenIndex(rule: StatementRule): number | null {
  if (rule.symbol_name_token_index != null) {
    return rule.symbol_name_token_index;
  }
  if (rule.value_token_index != null) {
    return rule.value_token_index;
  }
  const nameSlot = rule.fixed_slots?.find((slot) => slot.role === "name");
  if (nameSlot) {
    const idx = rule.fixed_slots?.indexOf(nameSlot) ?? -1;
    return idx >= 0 ? idx + 1 : null;
  }
  return null;
}

function addSite(
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  site: SymbolSite,
): void {
  const key = symbolKey(site.kind, site.name, site.scopeKey);
  if (site.role === "definition") {
    const list = definitions.get(key) ?? [];
    list.push(site);
    definitions.set(key, list);
  } else {
    references.push(site);
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

function proxyScopeKey(sectionType: string, sectionName: string): string {
  return `${sectionType}:${sectionName}`;
}

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

function collectFilterSequenceReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
): void {
  if (!scopeKey || line.tokens.length < 3) {
    return;
  }
  const keyword = line.tokens[0]?.text.toLowerCase();
  if (keyword !== "filter-sequence") {
    return;
  }
  const listToken = line.tokens[2];
  if (!listToken) {
    return;
  }
  const names = listToken.text.split(",");
  let offset = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) {
      offset += raw.length + 1;
      continue;
    }
    const start = listToken.start + listToken.text.indexOf(name, offset);
    references.push({
      kind: "filter",
      name,
      line: line.line,
      start,
      end: start + name.length,
      scopeKey,
      role: "reference",
    });
    offset = listToken.text.indexOf(name, offset) + name.length;
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

function collectHeuristicGlobalReferences(line: ParsedLine, references: SymbolSite[]): void {
  for (let i = 0; i < line.tokens.length - 1; i += 1) {
    const token = line.tokens[i];
    if (!token) {
      continue;
    }
    const lower = token.text.toLowerCase();

    if (lower === "resolvers") {
      pushReference(references, "resolvers", line.tokens[i + 1].text, line, i + 1, null);
      i += 1;
      continue;
    }

    if (lower === "peers") {
      pushReference(references, "peers", line.tokens[i + 1].text, line, i + 1, null);
      i += 1;
      continue;
    }

    if (lower === "cache-use" || lower === "cache-store") {
      pushReference(references, "cache", line.tokens[i + 1].text, line, i + 1, null);
      i += 1;
      continue;
    }

    if (
      lower === "filter" &&
      line.tokens[i + 1]?.text.toLowerCase() === "cache" &&
      line.tokens[i + 2]
    ) {
      pushReference(references, "cache", line.tokens[i + 2].text, line, i + 2, null);
      i += 2;
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
  addSite(definitions, [], defSite);

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

function collectStatementRuleSites(
  line: ParsedLine,
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
          if (site) {
            addSite(definitions, references, site);
          }
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
          if (site) {
            addSite(definitions, references, site);
          }
        }
      }
    }
  }

  collectAclReferences(line, scopeKey, references);
  collectFilterSequenceReferences(line, scopeKey, references);
  collectFilterSelfReference(line, scopeKey, references);
  collectHeuristicGlobalReferences(line, references);
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
    collectStatementRuleSites(line, rules, scopeKey, definitions, references);
  }

  return {
    definitions,
    references,
    referencesByKey: buildReferencesByKey(references),
    scopeKeyByLine,
  };
}

function buildReferencesByKey(references: SymbolSite[]): Map<string, SymbolSite[]> {
  const map = new Map<string, SymbolSite[]>();
  for (const site of references) {
    const key = symbolKey(site.kind, site.name, site.scopeKey);
    const list = map.get(key);
    if (list) {
      list.push(site);
    } else {
      map.set(key, [site]);
    }
  }
  return map;
}

export function getSymbolIndex(
  document: vscode.TextDocument,
  schema: HaproxySchema,
  maxLines: number,
): SymbolIndex | null {
  if (document.lineCount > maxLines) {
    return null;
  }

  const hit = indexCache.get(document);
  if (hit && hit.version === document.version) {
    return hit.index;
  }

  const parsed = getParsedDocument(document);
  const index = buildSymbolIndex(parsed, schema);
  indexCache.set(document, { version: document.version, index });
  return index;
}

function scopeKeyForLine(
  lineNo: number,
  scopeKeyByLine: (string | null)[] | undefined,
  parsed: ParsedLine[],
): string | null {
  if (scopeKeyByLine) {
    return scopeKeyByLine[lineNo] ?? null;
  }
  return buildScopeKeyByLine(parsed)[lineNo] ?? null;
}

function tokenAtPosition(line: ParsedLine, character: number): number | null {
  for (let i = 0; i < line.tokens.length; i += 1) {
    const tok = line.tokens[i];
    if (character >= tok.start && character <= tok.end) {
      return i;
    }
  }
  return null;
}

function resolveSectionHeaderSymbol(
  line: ParsedLine,
  tokenIndex: number,
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  if (!isTopLevelSectionHeader(line) || line.tokens.length < 2) {
    return null;
  }

  const sectionType = line.tokens[0].text.toLowerCase();
  const defKind = SECTION_DEFINITION_KINDS[sectionType];
  if (!defKind) {
    return null;
  }

  if (tokenIndex === 1) {
    return { kind: defKind, name: line.tokens[1].text, scopeKey: null };
  }

  for (let i = 2; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() === "from" && tokenIndex === i + 1) {
      return { kind: "defaults-profile", name: line.tokens[i + 1].text, scopeKey: null };
    }
  }

  return null;
}

function resolveStatementRuleSymbol(
  line: ParsedLine,
  tokenIndex: number,
  rules: StatementRule[],
  scopeKey: string | null,
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  for (const rule of rules) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }

    if (rule.definition_kind) {
      const idx = symbolNameTokenIndex(rule);
      if (idx === tokenIndex) {
        const token = line.tokens[idx];
        if (token) {
          return {
            kind: rule.definition_kind as SymbolKind,
            name: token.text,
            scopeKey,
          };
        }
      }
    }

    if (rule.reference_kind) {
      const idx = symbolNameTokenIndex(rule);
      if (idx === tokenIndex) {
        const token = line.tokens[idx];
        if (token) {
          const kind = rule.reference_kind as SymbolKind;
          return {
            kind,
            name: token.text,
            scopeKey: effectiveScopeKey(kind, scopeKey),
          };
        }
      }
    }
  }

  if (scopeKey) {
    const hit = aclReferenceAt(line, tokenIndex);
    if (hit) {
      return { kind: "acl", name: hit.name, scopeKey };
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
  const parsed = getParsedDocument(document);
  const line = parsed[position.line];
  if (!line || line.tokens.length === 0) {
    return null;
  }

  const tokenIndex = tokenAtPosition(line, position.character);
  if (tokenIndex === null) {
    return null;
  }

  if (line.isSectionHeader) {
    return resolveSectionHeaderSymbol(line, tokenIndex);
  }

  const scopeKey = scopeKeyForLine(position.line, scopeKeyByLine, parsed);

  return resolveStatementRuleSymbol(line, tokenIndex, schema.statement_rules ?? [], scopeKey);
}

export function findDefinitions(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): SymbolSite[] {
  return index.definitions.get(symbolKey(kind, name, scopeKey)) ?? [];
}

export function findReferences(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): SymbolSite[] {
  const key = symbolKey(kind, name, scopeKey);
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
  return index.referencesByKey.has(symbolKey(kind, name, scopeKey));
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
