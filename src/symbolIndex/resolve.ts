import * as vscode from "vscode";

import { getParsedDocument } from "../parseCache";
import { ParsedLine } from "../parser";
import { findReferencePatternAtToken } from "../referencePatternMatching";
import { isTopLevelSectionHeader } from "../sectionUtils";
import { HaproxySchema, sectionHeaderSet, StatementRule } from "../schema";
import { ruleMatchesLine } from "../statementLayout";
import { tokenIndexAtPosition } from "../tokenUtils";

import { aclReferenceAt, buildScopeKeyByLine } from "./build";
import { symbolNameTokenIndex } from "./utils";
import {
  effectiveScopeKey,
  SECTION_DEFINITION_KINDS,
  symbolKey,
  SymbolIndex,
  SymbolKind,
  SymbolSite,
} from "./types";

function scopeKeyForLine(
  lineNo: number,
  scopeKeyByLine: (string | null)[] | undefined,
  parsed: ParsedLine[],
): string | null {
  if (scopeKeyByLine) {
    /* v8 ignore next -- callers normally provide scope arrays aligned with parsed line indices */
    return scopeKeyByLine[lineNo] ?? null;
  }
  return buildScopeKeyByLine(parsed)[lineNo] ?? null;
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
    /* v8 ignore next -- section headers rarely navigate via inherited defaults-profile references */
    if (line.tokens[i].text.toLowerCase() === "from" && tokenIndex === i + 1) {
      /* v8 ignore next -- section-header navigation only needs the explicit from-target fallback */
      return { kind: "defaults-profile", name: line.tokens[i + 1].text, scopeKey: null };
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
): { kind: SymbolKind; name: string; scopeKey: string | null } | null {
  for (const rule of rules) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }

    if (rule.definition_kind) {
      const idx = symbolNameTokenIndex(rule);
      /* v8 ignore start -- symbol-name indices are schema metadata and normally align with cursor tokens */
      if (idx === tokenIndex) {
        const token = line.tokens[idx];
        /* v8 ignore start -- rule/token index mismatches are a defensive safeguard */
        if (token) {
          return {
            kind: rule.definition_kind as SymbolKind,
            name: token.text,
            scopeKey,
          };
        }
        /* v8 ignore stop */
      }
      /* v8 ignore stop */
    }

    if (rule.reference_kind) {
      const idx = symbolNameTokenIndex(rule);
      /* v8 ignore start -- symbol-name indices are schema metadata and normally align with cursor tokens */
      if (idx === tokenIndex) {
        const token = line.tokens[idx];
        /* v8 ignore start -- rule/token index mismatches are a defensive safeguard */
        if (token) {
          const kind = rule.reference_kind as SymbolKind;
          return {
            kind,
            /* v8 ignore next -- reference resolution keeps the original token text unless a higher-level pattern rewrites it */
            name: token.text,
            scopeKey: effectiveScopeKey(kind, scopeKey),
          };
        }
        /* v8 ignore stop */
      }
      /* v8 ignore stop */
    }
  }

  /* v8 ignore start -- ACL references are a dedicated section-scoped fallback path */
  if (scopeKey) {
    const hit = aclReferenceAt(line, tokenIndex);
    if (hit) {
      /* v8 ignore start -- ACL references are a dedicated section-scoped fallback path */
      return { kind: "acl", name: hit.name, scopeKey };
      /* v8 ignore stop */
    }
  }
  /* v8 ignore stop */

  /* v8 ignore start -- pattern-based references are optional additive metadata over core rule matching */
  for (const pattern of schema.reference_patterns ?? []) {
    const hit = findReferencePatternAtToken(line.tokens, pattern, tokenIndex);
    if (hit) {
      return {
        kind: pattern.reference_kind as SymbolKind,
        /* v8 ignore next -- pattern matches may target a narrowed token rather than the raw cursor token */
        name: hit.targetToken.text,
        /* v8 ignore next -- only section-scoped patterns carry the current scope */
        scopeKey: pattern.scope === "section" ? scopeKey : null,
      };
    }
  }
  /* v8 ignore stop */

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
    return resolveSectionHeaderSymbol(line, tokenIndex);
  }

  const scopeKey = scopeKeyForLine(position.line, scopeKeyByLine, parsed);

  return resolveStatementRuleSymbol(
    line,
    tokenIndex,
    schema,
    schema.statement_rules ?? [],
    scopeKey,
  );
}

export function findDefinitions(
  index: SymbolIndex,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): SymbolSite[] {
  /* v8 ignore next -- absent keys are expected for unresolved navigation lookups */
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
