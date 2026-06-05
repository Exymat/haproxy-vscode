import { ParsedLine, ParsedToken } from "./parser";
import { HaproxySchema, StatementRule } from "./schema";

export function ruleMatchesLine(rule: StatementRule, line: ParsedLine | ParsedToken[]): boolean {
  const tokens = Array.isArray(line) ? line : line.tokens;
  if (tokens.length === 0) {
    return false;
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
  for (const rule of schema.statement_rules ?? []) {
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
  return legacyActionTokenIndex(line);
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
  return legacyPhaseTokenIndex(line);
}

export function ruleActionGroup(rule: StatementRule | undefined): string | undefined {
  return rule?.group;
}

function legacyActionTokenIndex(line: ParsedLine): number | null {
  const tokens = line.tokens;
  if (tokens.length < 2) {
    return null;
  }
  const t0 = tokens[0].text.toLowerCase();
  if (t0 === "http-request" || t0 === "http-response" || t0 === "http-after-response") {
    return 1;
  }
  if (t0 === "tcp-request" || t0 === "tcp-response") {
    if (tokens.length >= 3) {
      const t1 = tokens[1].text.toLowerCase();
      if (t1 === "connection" || t1 === "session" || t1 === "content") {
        return 2;
      }
    }
    return 1;
  }
  return null;
}

function legacyPhaseTokenIndex(line: ParsedLine): number | null {
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 !== "tcp-request" && t0 !== "tcp-response") {
    return null;
  }
  if (line.tokens.length < 2) {
    return null;
  }
  return 1;
}
