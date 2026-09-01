/** Collects HAProxy runtime-variable definition and reference sites. */
import {
  findRuntimeVariableHits,
  findUnparenthesizedRuntimeVariable,
  tokenMayContainRuntimeVariables,
} from "../../core/runtimeVariables";
import { ParsedLine } from "../../parser";

import { SymbolKind, SymbolSite } from "../types";
import { addSite } from "../utils";

function pushHit(
  scopedKinds: Set<SymbolKind>,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  line: ParsedLine,
  hit: { name: string; start: number; end: number; role: "definition" | "reference" },
): void {
  addSite(scopedKinds, definitions, references, {
    kind: "variable",
    name: hit.name,
    line: line.line,
    start: hit.start,
    end: hit.end,
    scopeKey: null,
    role: hit.role,
  });
}

/** Collect set-var / var() / unset-var runtime-variable sites from line tokens. */
export function collectRuntimeVariableSites(
  line: ParsedLine,
  scopedKinds: Set<SymbolKind>,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
): void {
  for (const token of line.tokens) {
    if (!token || !tokenMayContainRuntimeVariables(token.text)) {
      continue;
    }
    for (const hit of findRuntimeVariableHits(token)) {
      pushHit(scopedKinds, definitions, references, line, hit);
    }
  }

  const unparenthesized = findUnparenthesizedRuntimeVariable(line);
  if (unparenthesized) {
    pushHit(scopedKinds, definitions, references, line, unparenthesized);
  }
}
