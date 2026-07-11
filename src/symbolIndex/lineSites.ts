import { ParsedLine } from "../parser";
import { isTopLevelSectionHeader } from "../language/sectionUtils";
import { HaproxySchema } from "../schema/types";

import { collectSectionHeaderSites } from "./collectors/sectionHeaders";
import { collectStatementRuleSites } from "./collectors/statementRules";
import { SymbolBuildContext } from "./context";
import { SymbolSite } from "./types";

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
