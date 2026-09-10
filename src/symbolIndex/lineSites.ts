/** Dispatches per-line symbol-site collection to section and statement collectors. */
import { ParsedLine } from "../parser";
import { isTopLevelSectionHeader as isTopLevelSectionHeaderImpl } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";

import { collectSectionHeaderSites as collectSectionHeaderSitesImpl } from "./collectors/sectionHeaders";
import { collectStatementRuleSites as collectStatementRuleSitesImpl } from "./collectors/statementRules";
import { SymbolBuildContext } from "./context";
import { SymbolSite } from "./types";

const isTopLevelSectionHeader = isTopLevelSectionHeaderImpl;
const collectSectionHeaderSites = collectSectionHeaderSitesImpl;
const collectStatementRuleSites = collectStatementRuleSitesImpl;

export function collectLineSitesInto(
  line: ParsedLine,
  schema: HaproxySchema,
  scopeKey: string | null,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  context: SymbolBuildContext,
): void {
  if (isTopLevelSectionHeader(line)) {
    collectSectionHeaderSites(line, schema, definitions, references, context.scopedSymbolKinds);
    return;
  }
  collectStatementRuleSites(line, schema, scopeKey, definitions, references, context);
}
