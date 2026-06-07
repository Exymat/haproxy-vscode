import { LineDiagnosticMemo } from "../../src/diagnosticContext";
import { ParsedLine } from "../../src/parser";
import {
  HaproxySchema,
  modifierPrefixSet,
  noPrefixKeywordSet,
  sectionKeywordSet,
} from "../../src/schema";
import { findStatementRule } from "../../src/statementLayout";
import { resolveLongestDirectiveMatch } from "../../src/tokenUtils";

export function buildLineDiagnosticMemo(
  line: ParsedLine,
  schema: HaproxySchema,
  allowed?: Set<string>,
): LineDiagnosticMemo {
  const sectionAllowed = allowed ?? sectionKeywordSet(schema, line.section);
  return {
    allowed: sectionAllowed,
    directiveMatch: resolveLongestDirectiveMatch(
      line,
      sectionAllowed,
      4,
      noPrefixKeywordSet(schema),
      modifierPrefixSet(schema),
    ),
    statementRule: findStatementRule(schema, line),
  };
}
