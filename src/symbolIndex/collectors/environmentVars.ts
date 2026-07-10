import { findEnvironmentVariableReferences } from "../../environmentVariables";
import { ParsedLine } from "../../parser";

import { SymbolSite } from "../types";

/** Collect environment-variable references from $NAME / ${NAME} expansions in line tokens. */
export function collectEnvironmentVariableSites(line: ParsedLine, references: SymbolSite[]): void {
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
