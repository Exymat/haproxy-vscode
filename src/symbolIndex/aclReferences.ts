import { isAclOnlyCriterion } from "../aclCondition";
import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema";

import { SymbolSite } from "./types";

const SAMPLE_FETCH_REF = /^([a-z_][\w.-]*)\(([^)]*)\)$/i;

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

export function aclReferenceExpectedAt(
  schema: HaproxySchema,
  line: ParsedLine,
  tokenIndex: number,
  aclOperators: Set<string>,
  fetchNames: Set<string>,
  aclCriteria: Set<string>,
): boolean {
  const tokens = line.tokens;
  const conditionStart = aclConditionStartIndex(tokens);
  if (conditionStart === null || tokenIndex < conditionStart) {
    return false;
  }

  const token = tokens[tokenIndex];
  const prev = tokens[tokenIndex - 1]?.text;
  const allowChainedReferences = braceDepthAt(tokens, tokenIndex, conditionStart) === 0;

  if (token) {
    if (
      token.text === "{" ||
      token.text === "}" ||
      token.text === "!" ||
      aclOperators.has(token.text)
    ) {
      return false;
    }
    if (prev === "{" && fetchNames.has(token.text.toLowerCase())) {
      return false;
    }
    const fetchCall = SAMPLE_FETCH_REF.exec(token.text);
    if (prev === "{" && fetchCall && fetchNames.has(fetchCall[1].toLowerCase())) {
      return false;
    }
    if (
      prev === "{" &&
      isAclOnlyCriterion(token.text, aclCriteria, fetchNames, schema.sample_fetches ?? {})
    ) {
      return false;
    }
    if (!aclReferenceContextAfterPrev(schema, prev, aclOperators, allowChainedReferences)) {
      return false;
    }
    return isPlainAclNameToken(token.text);
  }

  if (!aclReferenceContextAfterPrev(schema, prev, aclOperators, allowChainedReferences)) {
    return false;
  }

  return true;
}

export function aclReferenceAt(
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

export function collectAclReferences(
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
