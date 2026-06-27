import { conditionalStartIndex } from "./directiveUtils";
import { resolveLineOptionStartIndex } from "./lineOptionSpan";
import { ParsedLine } from "./parser";
import { HaproxySchema, StatementRule } from "./schema";
import {
  findStatementRule,
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
} from "./statementLayout";
import { DirectiveMatch, resolveLongestDirectiveMatch } from "./tokenUtils";

export interface ResolvedStatement {
  rule: StatementRule | undefined;
  actionTokenIndex: number | null;
  phaseTokenIndex: number | null;
  lineOptionStart: number;
}

export interface AnalyzedLine {
  line: ParsedLine;
  allowed: Set<string>;
  directiveMatch: DirectiveMatch;
  statement: ResolvedStatement;
  conditionalStart: number;
}

export interface AnalyzeLineContext {
  schema: HaproxySchema;
  allowed: Set<string>;
  noPrefix: Set<string>;
  modifierPrefixes: Set<string>;
}

export function resolveStatement(line: ParsedLine, schema: HaproxySchema): ResolvedStatement {
  const rule = findStatementRule(schema, line);
  return {
    rule,
    actionTokenIndex: resolveActionTokenIndex(rule, line),
    phaseTokenIndex: resolvePhaseTokenIndex(rule, line),
    lineOptionStart: resolveLineOptionStartIndex(line, rule),
  };
}

export function analyzeLine(line: ParsedLine, ctx: AnalyzeLineContext): AnalyzedLine {
  const statement = resolveStatement(line, ctx.schema);
  return {
    line,
    allowed: ctx.allowed,
    directiveMatch: resolveLongestDirectiveMatch(
      line,
      ctx.allowed,
      4,
      ctx.noPrefix,
      ctx.modifierPrefixes,
    ),
    statement,
    conditionalStart: conditionalStartIndex(line, 0),
  };
}
