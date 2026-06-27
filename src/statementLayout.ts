import { ParsedLine, ParsedToken } from "./parser";
import { HaproxySchema, StatementRule } from "./schema";

const statementRuleIndexCache = new WeakMap<HaproxySchema, Map<string, StatementRule[]>>();

function ruleIndexKey(rule: StatementRule): string {
  if (rule.match_tokens?.[0]) {
    return rule.match_tokens[0].toLowerCase();
  }
  if (rule.prefix) {
    return rule.prefix.split(/\s+/)[0].toLowerCase();
  }
  return rule.keyword.toLowerCase();
}

function statementRulesByFirstToken(schema: HaproxySchema): Map<string, StatementRule[]> {
  let index = statementRuleIndexCache.get(schema);
  if (index) {
    return index;
  }
  index = new Map();
  for (const rule of schema.statement_rules ?? []) {
    const key = ruleIndexKey(rule);
    const list = index.get(key) ?? [];
    list.push(rule);
    index.set(key, list);
  }
  statementRuleIndexCache.set(schema, index);
  return index;
}

function candidateRules(schema: HaproxySchema, line: ParsedLine | ParsedToken[]): StatementRule[] {
  const tokens = Array.isArray(line) ? line : line.tokens;
  const t0 = tokens[0]?.text.toLowerCase();
  if (!t0) {
    return [];
  }
  const index = statementRulesByFirstToken(schema);
  return index.get(t0) ?? [];
}

export function ruleMatchesLine(rule: StatementRule, line: ParsedLine | ParsedToken[]): boolean {
  const tokens = Array.isArray(line) ? line : line.tokens;
  if (tokens.length === 0) {
    return false;
  }
  if (rule.match_tokens?.length) {
    if (tokens.length < rule.match_tokens.length) {
      return false;
    }
    return rule.match_tokens.every((token, index) => tokens[index]?.text.toLowerCase() === token);
  }
  const t0 = tokens[0].text.toLowerCase();
  if (rule.prefix) {
    const parts = rule.prefix.split(/\s+/);
    if (parts.length === 1) {
      return t0 === parts[0] && tokens[1]?.text.toLowerCase() === rule.keyword.toLowerCase();
    }
    if (parts.length === 2) {
      return (
        t0 === parts[0] &&
        tokens[1]?.text.toLowerCase() === parts[1] &&
        (rule.keyword === parts[1] || tokens[1]?.text.toLowerCase() === rule.keyword.toLowerCase())
      );
    }
    return false;
  }
  return t0 === rule.keyword.toLowerCase();
}

export function findStatementRule(
  schema: HaproxySchema,
  line: ParsedLine,
): StatementRule | undefined {
  for (const rule of candidateRules(schema, line)) {
    if (ruleMatchesLine(rule, line)) {
      return rule;
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
