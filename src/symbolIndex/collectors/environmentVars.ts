/** Collects environment-variable reference sites from token expansions. */
import { findEnvironmentVariableReferences } from "../../core/environmentVariables";
import { ParsedLine } from "../../parser";

import { SymbolSite } from "../types";

function containsEnvSampleFetch(text: string): boolean {
  for (let i = 0; i <= text.length - 4; i += 1) {
    if ((text.charCodeAt(i) | 32) !== 101) {
      continue;
    }
    if ((text.charCodeAt(i + 1) | 32) !== 110) {
      continue;
    }
    if ((text.charCodeAt(i + 2) | 32) !== 118) {
      continue;
    }
    if (text.charCodeAt(i + 3) === 40) {
      return true;
    }
  }
  return false;
}

function tokenMayContainEnvironmentReferences(text: string): boolean {
  return text.includes("$") || containsEnvSampleFetch(text);
}

/** Collect environment-variable references from $NAME / ${NAME} expansions in line tokens. */
export function collectEnvironmentVariableSites(line: ParsedLine, references: SymbolSite[]): void {
  for (const token of line.tokens) {
    if (!token) {
      continue;
    }
    if (!tokenMayContainEnvironmentReferences(token.text)) {
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
