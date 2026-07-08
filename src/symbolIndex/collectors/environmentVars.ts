import {
  findEnvironmentVariableReferences,
  isEnvironmentVariableName,
} from "../../environmentVariables";
import { ParsedLine } from "../../parser";

import { addSite } from "../utils";
import { SymbolKind, SymbolSite } from "../types";

export function collectEnvironmentVariableSites(
  line: ParsedLine,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  scopedSymbolKinds: Set<SymbolKind>,
): void {
  const keyword = line.tokens[0]?.text.toLowerCase();

  if ((keyword === "setenv" || keyword === "presetenv") && line.tokens[1]) {
    const token = line.tokens[1];
    if (isEnvironmentVariableName(token.text)) {
      addSite(scopedSymbolKinds, definitions, references, {
        kind: "environment-variable",
        name: token.text,
        line: line.line,
        start: token.start,
        end: token.end,
        scopeKey: null,
        role: "definition",
      });
    }
  } else if (keyword === "unsetenv" || keyword === "resetenv") {
    for (let i = 1; i < line.tokens.length; i += 1) {
      const token = line.tokens[i];
      if (!token || !isEnvironmentVariableName(token.text)) {
        continue;
      }
      references.push({
        kind: "environment-variable",
        name: token.text,
        line: line.line,
        start: token.start,
        end: token.end,
        scopeKey: null,
        role: "reference",
      });
    }
  }

  for (const token of line.tokens) {
    if (!token) {
      continue;
    }
    for (const hit of findEnvironmentVariableReferences(token)) {
      references.push({
        kind: "environment-variable",
        name: hit.name,
        line: line.line,
        start: hit.start,
        end: hit.end,
        scopeKey: null,
        role: "reference",
      });
    }
  }
}
