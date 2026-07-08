import { ParsedLine } from "../../parser";
import { HaproxySchema } from "../../schema";

import { sectionDefinitionKinds, SymbolKind, SymbolSite } from "../types";
import { addSite } from "../utils";

export function collectSectionHeaderSites(
  line: ParsedLine,
  schema: HaproxySchema,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  scopedSymbolKinds: Set<SymbolKind>,
): void {
  const sectionType = line.tokens[0].text.toLowerCase();
  const defKind = sectionDefinitionKinds(schema)[sectionType];
  if (!defKind || line.tokens.length < 2) {
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

  for (let i = 2; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() !== "from") {
      continue;
    }
    const refToken = line.tokens[i + 1];
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
