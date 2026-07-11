import { LineDiagnosticMemo } from "../../src/diagnostics/diagnosticContext";
import { analyzeLine } from "../../src/parser/lineAnalysis";
import { ParsedLine } from "../../src/parser";
import { HaproxySchema } from "../../src/schema/types";
import { sectionHasOptionKeywords, sectionKeywordSet } from "../../src/schema/keywords";
import { modifierPrefixSet, noPrefixKeywordSet } from "../../src/schema/tokens";

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
