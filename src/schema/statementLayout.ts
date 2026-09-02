/** Matches parsed lines to schema statement rules and resolves action/phase token positions. */
import { ParsedLine, ParsedToken } from "../parser";
import { HaproxySchema, StatementRule } from "./types";

interface IndexedStatementRule {
  rule: StatementRule;
  matchTokensLower: string[] | undefined;
  prefixPartsLower: string[] | undefined;
  keywordLower: string;
}

const statementRuleIndexCache = new WeakMap<HaproxySchema, Map<string, IndexedStatementRule[]>>();

function indexStatementRule(rule: StatementRule): IndexedStatementRule {
  return {
    rule,
    matchTokensLower: rule.match_tokens?.map((token) => token.toLowerCase()),
    prefixPartsLower: rule.prefix?.split(/\s+/).map((part) => part.toLowerCase()),
    keywordLower: rule.keyword.toLowerCase(),
  };
}

function ruleIndexKey(indexed: IndexedStatementRule): string {
  if (indexed.matchTokensLower?.[0]) {
    return indexed.matchTokensLower[0];
  }
  if (indexed.prefixPartsLower?.[0]) {
    return indexed.prefixPartsLower[0];
  }
  return indexed.keywordLower;
}

function statementRulesByFirstToken(schema: HaproxySchema): Map<string, IndexedStatementRule[]> {
  let index = statementRuleIndexCache.get(schema);
  if (index) {
    return index;
  }
  index = new Map();
  for (const rule of schema.statement_rules ?? []) {
    const indexed = indexStatementRule(rule);
    const key = ruleIndexKey(indexed);
    const list = index.get(key) ?? [];
    list.push(indexed);
    index.set(key, list);
  }
  statementRuleIndexCache.set(schema, index);
  return index;
}

export function candidateRules(
  schema: HaproxySchema,
  line: ParsedLine | ParsedToken[],
): StatementRule[] {
  const tokens = Array.isArray(line) ? line : line.tokens;
  const t0 = tokens[0]?.text.toLowerCase();
  if (!t0) {
    return [];
  }
  const index = statementRulesByFirstToken(schema);
  return (index.get(t0) ?? []).map((indexed) => indexed.rule);
}

function indexedRuleMatchesLine(indexed: IndexedStatementRule, tokens: ParsedToken[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  if (indexed.matchTokensLower?.length) {
    if (tokens.length < indexed.matchTokensLower.length) {
      return false;
    }
    return indexed.matchTokensLower.every(
      (token, index) => tokens[index]?.text.toLowerCase() === token,
    );
  }
  const t0 = tokens[0].text.toLowerCase();
  const parts = indexed.prefixPartsLower;
  if (parts) {
    if (parts.length === 1) {
      return t0 === parts[0] && tokens[1]?.text.toLowerCase() === indexed.keywordLower;
    }
    if (parts.length === 2) {
      const t1 = tokens[1]?.text.toLowerCase();
      return (
        t0 === parts[0] &&
        t1 === parts[1] &&
        (indexed.rule.keyword === parts[1] || t1 === indexed.keywordLower)
      );
    }
    return false;
  }
  return t0 === indexed.keywordLower;
}

export function ruleMatchesLine(rule: StatementRule, line: ParsedLine | ParsedToken[]): boolean {
  const tokens = Array.isArray(line) ? line : line.tokens;
  return indexedRuleMatchesLine(indexStatementRule(rule), tokens);
}

export function findStatementRule(
  schema: HaproxySchema,
  line: ParsedLine,
): StatementRule | undefined {
  const tokens = line.tokens;
  const t0 = tokens[0]?.text.toLowerCase();
  if (!t0) {
    return undefined;
  }
  for (const indexed of statementRulesByFirstToken(schema).get(t0) ?? []) {
    if (indexedRuleMatchesLine(indexed, tokens)) {
      return indexed.rule;
    }
  }
  return undefined;
}

export function resolveActionTokenIndex(
  rule: StatementRule | undefined,
  line: ParsedLine,
): number | null {
  if (rule?.action_token_index !== undefined) {
    if (rule.action_token_index >= line.tokens.length) {
      return null;
    }
    return rule.action_token_index;
  }
  return null;
}

export function resolvePhaseTokenIndex(
  rule: StatementRule | undefined,
  line: ParsedLine,
): number | null {
  if (rule?.phase_token_index !== undefined) {
    if (rule.phase_token_index >= line.tokens.length) {
      return null;
    }
    return rule.phase_token_index;
  }
  return null;
}

export function ruleActionGroup(rule: StatementRule | undefined): string | undefined {
  return rule?.group;
}
