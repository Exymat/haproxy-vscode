import * as vscode from "vscode";

import { getParsedDocument } from "./parseCache";
import { ParsedLine } from "./parser";
import { isTopLevelSectionHeader } from "./sectionUtils";
import { HaproxySchema, StatementRule } from "./schema";
import { ruleMatchesLine } from "./statementLayout";

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

function aclReferenceAt(
  line: ParsedLine,
  tokenIndex: number,
): { name: string; tokenIndex: number } | null {
  const tokens = line.tokens;
  const token = tokens[tokenIndex];
  if (!token) {
    return null;
  }

  const prev = tokens[tokenIndex - 1]?.text.toLowerCase();
  const prev2 = tokens[tokenIndex - 2]?.text.toLowerCase();

  if ((prev === "if" || prev === "unless") && token.text !== "{" && token.text !== "!") {
    if (token.text.startsWith("!") && token.text.length > 1) {
      return { name: token.text.slice(1), tokenIndex };
    }
    return { name: token.text, tokenIndex };
  }

  if (prev === "!" && (prev2 === "if" || prev2 === "unless") && token.text !== "{") {
    return { name: token.text, tokenIndex };
  }

  return null;
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
}

export function buildSymbolIndex(parsed: ParsedLine[], schema: HaproxySchema): SymbolIndex {
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const rules = schema.statement_rules ?? [];

  let currentScopeKey: string | null = null;

  for (const line of parsed) {
    if (isTopLevelSectionHeader(line) && line.tokens.length >= 2) {
      const sectionType = line.tokens[0].text.toLowerCase();
      if (PROXY_SECTIONS.has(sectionType)) {
        currentScopeKey = proxyScopeKey(sectionType, line.tokens[1].text);
      } else {
        currentScopeKey = null;
      }
      collectSectionHeaderSites(line, definitions, references);
      continue;
    }

    if (isTopLevelSectionHeader(line)) {
      currentScopeKey = null;
      collectSectionHeaderSites(line, definitions, references);
      continue;
    }

    collectStatementRuleSites(line, rules, currentScopeKey, definitions, references);
  }

  return { definitions, references };
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

  let scopeKey: string | null = null;
  for (let i = position.line; i >= 0; i -= 1) {
    const entry = parsed[i];
    if (isTopLevelSectionHeader(entry) && entry.tokens.length >= 2) {
      const sectionType = entry.tokens[0].text.toLowerCase();
      if (PROXY_SECTIONS.has(sectionType)) {
        scopeKey = proxyScopeKey(sectionType, entry.tokens[1].text);
      }
      break;
    }
  }

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
  const lower = name.toLowerCase();
  const refs = index.references.filter(
    (site) =>
      site.kind === kind &&
      site.name.toLowerCase() === lower &&
      (site.scopeKey ?? "") === (scopeKey ?? ""),
  );
  return refs;
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
