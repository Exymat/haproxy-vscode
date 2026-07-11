import * as vscode from "vscode";

import { getParsedDocument } from "../parser/parseCache";
import { ParsedLine } from "../parser";
import { findReferencePatternMatches } from "../parser/referencePatternMatching";
import { ReferencePattern } from "../schema/types";
import { ParsedToken } from "../parser";
import { isTopLevelSectionHeader, parseSectionHeader } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";
import { symbolStringList } from "../schema/symbols";
import { keywordGroupSet } from "../schema/keywords";
import { sectionHeaderSet } from "../schema/layout";
import { sampleExpressionNameSets } from "../schema/tokens";
import { candidateRules, ruleMatchesLine } from "../formatting/statementLayout";
import { isLikelyValue, resolveTokenIndex } from "../parser/tokenUtils";

import { aclReferenceExpectedAt } from "./aclReferences";
import { fetchReferenceRules } from "./context";
import { buildScopeKeyByLine } from "./scope";
import { symbolNameTokenIndex } from "./utils";
import { effectiveScopeKeyForSchema, SymbolIndex, SymbolKind } from "./types";
import { resolveSymbolAtPosition } from "./resolve";

export interface ExpectedSymbolReference {
  kind: SymbolKind;
  scopeKey: string | null;
}

const SAMPLE_FETCH_REF = /^([a-z_][\w.-]*)\(([^)]*)\)$/i;
const SAMPLE_FETCH_OPEN = /^([a-z_][\w.-]*)\(([^)]*)$/i;

function tokensMatchPatternAt(
  tokens: ParsedToken[],
  start: number,
  matchTokens: string[],
): boolean {
  for (let i = 0; i < matchTokens.length; i += 1) {
    const expected = matchTokens[i]?.toLowerCase();
    if (expected === "*") {
      continue;
    }
    if (tokens[start + i]?.text.toLowerCase() !== expected) {
      return false;
    }
  }
  return true;
}

function referencePatternPrefixMatches(
  tokens: ParsedToken[],
  pattern: ReferencePattern,
  tokenIndex: number,
): boolean {
  const start = tokenIndex - pattern.target_token_index;
  if (start < 0) {
    return false;
  }
  return tokensMatchPatternAt(tokens, start, pattern.match_tokens);
}

function parseSampleFetchToken(tokenText: string): { fetch: string; args: string } | null {
  const closed = SAMPLE_FETCH_REF.exec(tokenText);
  if (closed) {
    return { fetch: closed[1], args: closed[2] };
  }
  const open = SAMPLE_FETCH_OPEN.exec(tokenText);
  if (open) {
    return { fetch: open[1], args: open[2] };
  }
  return null;
}

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

function isDefinitionSymbolPosition(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
): boolean {
  if (line.isSectionHeader) {
    if (tokenIndex === 1) {
      return true;
    }
    return false;
  }

  for (const rule of candidateRules(schema, line)) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }
    if (!rule.definition_kind) {
      continue;
    }
    const idx = symbolNameTokenIndex(rule);
    if (idx === tokenIndex) {
      return true;
    }
  }

  return false;
}

function expectedSectionHeaderReference(
  line: ParsedLine,
  tokenIndex: number,
  character: number,
  schema: HaproxySchema,
): ExpectedSymbolReference | null {
  if (!isTopLevelSectionHeader(line)) {
    return null;
  }
  const header = parseSectionHeader(line, schema);
  if (!header || header.fromIndex < 0) {
    return null;
  }
  const profileIndex = header.fromIndex + 1;
  const fromToken = line.tokens[header.fromIndex];
  const afterFrom = fromToken !== undefined && character > fromToken.end;
  if (tokenIndex < profileIndex && !afterFrom) {
    return null;
  }
  const token = line.tokens[tokenIndex];
  if (token && isLikelyValue(token.text)) {
    return null;
  }
  return { kind: "defaults-profile", scopeKey: null };
}

function expectedStatementRuleReference(
  line: ParsedLine,
  tokenIndex: number,
  schema: HaproxySchema,
  scopeKey: string | null,
): ExpectedSymbolReference | null {
  for (const rule of candidateRules(schema, line)) {
    if (!ruleMatchesLine(rule, line.tokens)) {
      continue;
    }
    if (!rule.reference_kind) {
      continue;
    }
    const idx = symbolNameTokenIndex(rule);
    if (idx !== tokenIndex) {
      continue;
    }
    const token = line.tokens[tokenIndex];
    if (token && isLikelyValue(token.text)) {
      return null;
    }
    const kind = rule.reference_kind;
    return { kind, scopeKey: effectiveScopeKeyForSchema(schema, kind, scopeKey) };
  }
  return null;
}

function splitSegmentAtOffset(
  text: string,
  split: string,
  offset: number,
): { inSegment: boolean; afterDelimiter: boolean } {
  let cursor = 0;
  const parts = text.split(split);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    const partStart = cursor;
    const partEnd = partStart + part.length;
    if (offset >= partStart && offset <= partEnd) {
      return { inSegment: true, afterDelimiter: false };
    }
    cursor = partEnd;
    if (i < parts.length - 1) {
      if (offset > partEnd && offset <= partEnd + split.length) {
        return { inSegment: false, afterDelimiter: true };
      }
      cursor += split.length;
    }
  }
  return { inSegment: false, afterDelimiter: false };
}

function expectedReferencePatternAt(
  line: ParsedLine,
  tokenIndex: number,
  character: number,
  pattern: ReferencePattern,
  scopeKey: string | null,
): ExpectedSymbolReference | null {
  const refScopeKey = pattern.scope === "section" ? scopeKey : null;
  const kind = pattern.reference_kind;

  if (!line.tokens[tokenIndex] && referencePatternPrefixMatches(line.tokens, pattern, tokenIndex)) {
    return { kind, scopeKey: refScopeKey };
  }

  for (const hit of findReferencePatternMatches(line.tokens, pattern)) {
    if (hit.targetIndex !== tokenIndex) {
      continue;
    }

    const targetToken = hit.targetToken;
    if (!pattern.split) {
      if (character >= targetToken.start && character <= targetToken.end) {
        return { kind, scopeKey: refScopeKey };
      }
      continue;
    }

    if (character < targetToken.start || character > targetToken.end) {
      continue;
    }

    return { kind, scopeKey: refScopeKey };
  }

  return null;
}

function expectedSampleFetchReferenceAt(
  line: ParsedLine,
  character: number,
  rules: ReturnType<typeof fetchReferenceRules>,
  scopeKey: string | null,
): ExpectedSymbolReference | null {
  for (const token of line.tokens) {
    const parsedFetch = parseSampleFetchToken(token.text);
    if (!parsedFetch) {
      continue;
    }
    const fetch = parsedFetch.fetch.toLowerCase();
    const rule = rules[fetch];
    if (!rule) {
      continue;
    }

    const openParen = token.text.indexOf("(");
    const closeParen = token.text.lastIndexOf(")");
    const argsStart = token.start + openParen + 1;
    const argsEnd = closeParen > openParen ? token.start + closeParen : token.end;
    if (character < argsStart || character > argsEnd) {
      continue;
    }

    const argIndex = rule.argument_index ?? 0;
    const rawArgs = parsedFetch.args;
    const argParts = rawArgs.split(",");
    let rawArgStart = 0;
    for (let partIndex = 0; partIndex < argIndex; partIndex += 1) {
      rawArgStart += (argParts[partIndex]?.length ?? 0) + 1;
    }
    const rawArg = argParts[argIndex] ?? "";
    const argStart = argsStart + rawArgStart;
    const argEnd = argStart + rawArg.length;
    if (character < argStart || character > Math.max(argEnd, argStart)) {
      continue;
    }

    const refScope = rule.scope === "section" ? scopeKey : null;
    return { kind: rule.reference_kind, scopeKey: refScope };
  }

  return null;
}

function expectedReferenceAtTokenIndex(
  line: ParsedLine,
  tokenIndex: number,
  character: number,
  schema: HaproxySchema,
  scopeKey: string | null,
): ExpectedSymbolReference | null {
  if (line.isSectionHeader) {
    return expectedSectionHeaderReference(line, tokenIndex, character, schema);
  }

  const statementRef = expectedStatementRuleReference(line, tokenIndex, schema, scopeKey);
  if (statementRef) {
    return statementRef;
  }

  if (scopeKey) {
    const aclOperators = new Set(symbolStringList(schema, "acl_condition_operators"));
    const fetchNames = sampleExpressionNameSets(schema).fetchNames;
    const aclCriteria = keywordGroupSet(schema, "acl_criteria");
    if (aclReferenceExpectedAt(schema, line, tokenIndex, aclOperators, fetchNames, aclCriteria)) {
      return { kind: "acl", scopeKey };
    }
  }

  for (const pattern of schema.reference_patterns ?? []) {
    const hit = expectedReferencePatternAt(line, tokenIndex, character, pattern, scopeKey);
    if (hit) {
      return hit;
    }
  }

  const fetchRef = expectedSampleFetchReferenceAt(
    line,
    character,
    fetchReferenceRules(schema),
    scopeKey,
  );
  if (fetchRef) {
    return fetchRef;
  }

  return null;
}

export function resolveExpectedSymbolReferenceAtCompletion(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  scopeKeyByLine?: (string | null)[],
): ExpectedSymbolReference | null {
  const parsed = getParsedDocument(document, { sectionHeaders: sectionHeaderSet(schema) });
  const line = parsed[position.line];
  if (!line || line.tokens.length === 0) {
    return null;
  }

  const { index: tokenIndex, token } = resolveTokenIndex(line, position.character);
  if (token && isDefinitionSymbolPosition(line, tokenIndex, schema)) {
    return null;
  }

  const scopeKey = scopeKeyForLine(position.line, scopeKeyByLine, parsed, schema);

  if (token) {
    const resolved = resolveSymbolAtPosition(document, position, schema, scopeKeyByLine);
    if (resolved) {
      if (resolved.kind === "environment-variable") {
        return null;
      }
      if (isLikelyValue(token.text)) {
        return null;
      }
      return { kind: resolved.kind, scopeKey: resolved.scopeKey };
    }
  }

  return expectedReferenceAtTokenIndex(line, tokenIndex, position.character, schema, scopeKey);
}

export function listDefinitionNames(
  index: SymbolIndex,
  kind: SymbolKind,
  scopeKey: string | null,
): string[] {
  const names = new Set<string>();

  for (const defs of index.definitions.values()) {
    for (const site of defs) {
      if (site.kind !== kind || site.role !== "definition") {
        continue;
      }
      if (index.scopedSymbolKinds.has(kind) && site.scopeKey !== scopeKey) {
        continue;
      }
      names.add(site.name);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Exported for unit tests that exercise reference-detection edge cases. */
export const expectedReferenceTesting = {
  splitSegmentAtOffset,
  tokensMatchPatternAt,
  referencePatternPrefixMatches,
  expectedReferenceAtTokenIndex,
  parseSampleFetchToken,
  expectedReferencePatternAt,
  expectedSampleFetchReferenceAt,
  isDefinitionSymbolPosition,
};
