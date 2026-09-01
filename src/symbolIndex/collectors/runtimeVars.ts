/** Collects HAProxy runtime-variable definition and reference sites. */
import {
  findRuntimeVariableHits,
  isRuntimeVariableName,
  isUnparenthesizedRuntimeVariableKeyword,
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
  let unparenthesizedFound = false;
  for (let index = 0; index < line.tokens.length; index += 1) {
    const token = line.tokens[index];
    if (!token) {
      continue;
    }

    if (tokenMayContainRuntimeVariables(token.text)) {
      for (const hit of findRuntimeVariableHits(token)) {
        pushHit(scopedKinds, definitions, references, line, hit);
      }
    }

    if (unparenthesizedFound || !isUnparenthesizedRuntimeVariableKeyword(token.text)) {
      continue;
    }
    const nameToken = line.tokens[index + 1];
    if (!nameToken || !isRuntimeVariableName(nameToken.text)) {
      continue;
    }
    pushHit(scopedKinds, definitions, references, line, {
      name: nameToken.text,
      start: nameToken.start,
      end: nameToken.end,
      role: "definition",
    });
    unparenthesizedFound = true;
  }
}
