import { ParsedLine } from "../../parser";
import { HaproxySchema } from "../../schema/types";
import { parseSectionHeader } from "../../language/sectionUtils";

import { sectionDefinitionKinds, SymbolKind, SymbolSite } from "../types";
import { addSite } from "../utils";

export function collectSectionHeaderSites(
  line: ParsedLine,
  schema: HaproxySchema,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  scopedSymbolKinds: Set<SymbolKind>,
): void {
  const header = parseSectionHeader(line, schema);
  if (!header || line.tokens.length < 2) {
    return;
  }

  const defKind = sectionDefinitionKinds(schema)[header.sectionType];
  if (!defKind) {
    return;
  }

  const nameToken = line.tokens[1];
  const defSite: SymbolSite = {
    kind: defKind,
    name: nameToken.text,
    line: line.line,
    start: nameToken.start,
    end: nameToken.end,
    scopeKey: null,
    role: "definition",
  };
  addSite(scopedSymbolKinds, definitions, references, defSite);

  if (header.fromIndex >= 0 && header.profileName) {
    const refToken = line.tokens[header.fromIndex + 1];
    addSite(scopedSymbolKinds, definitions, references, {
      kind: "defaults-profile",
      name: refToken.text,
      line: line.line,
      start: refToken.start,
      end: refToken.end,
      scopeKey: null,
      role: "reference",
    });
  }
}
