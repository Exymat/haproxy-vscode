import { LineDiagnosticMemo } from "../../src/diagnosticContext";
import { analyzeLine } from "../../src/lineAnalysis";
import { ParsedLine } from "../../src/parser";
import {
  HaproxySchema,
  modifierPrefixSet,
  noPrefixKeywordSet,
  sectionHasOptionKeywords,
  sectionKeywordSet,
} from "../../src/schema";

export function buildLineDiagnosticMemo(
  line: ParsedLine,
  schema: HaproxySchema,
  allowed?: Set<string>,
): LineDiagnosticMemo {
  const sectionAllowed = allowed ?? sectionKeywordSet(schema, line.section);
  const noPrefix = noPrefixKeywordSet(schema);
  const modifierPrefixes = modifierPrefixSet(schema);
  const analyzed = analyzeLine(line, {
    schema,
    allowed: sectionAllowed,
    noPrefix,
    modifierPrefixes,
  });
  return {
    allowed: sectionAllowed,
    hasOptionKeywords: sectionHasOptionKeywords(schema, line.section),
    directiveMatch: analyzed.directiveMatch,
    statementRule: analyzed.statement.rule,
    analyzed,
  };
}
