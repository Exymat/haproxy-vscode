import { ParsedLine } from "../../parser";

import { FetchReferenceRule } from "../context";
import { pushReferenceRange } from "../referenceHelpers";
import { SymbolKind, SymbolSite } from "../types";

const SAMPLE_FETCH_REF = /^([a-z_][\w.-]*)\(([^)]*)\)$/i;

export function collectSampleFetchReferences(
  line: ParsedLine,
  scopeKey: string | null,
  references: SymbolSite[],
  rules: Record<string, FetchReferenceRule>,
): void {
  for (let i = 0; i < line.tokens.length; i += 1) {
    const token = line.tokens[i];
    if (!token) {
      continue;
    }
    const match = SAMPLE_FETCH_REF.exec(token.text);
    if (!match) {
      continue;
    }
    const fetch = match[1].toLowerCase();
    const rule = rules[fetch];
    if (!rule) {
      continue;
    }
    const argIndex = rule.argument_index ?? 0;
    const rawArgs = match[2];
    const rawArg = rawArgs.split(",")[argIndex] ?? "";
    const arg = rawArg.trim();
    if (!arg) {
      continue;
    }
    const refScope = rule.scope === "section" ? scopeKey : null;
    const openParen = token.text.indexOf("(");
    const argParts = rawArgs.split(",");
    let rawArgStart = 0;
    for (let partIndex = 0; partIndex < argIndex; partIndex += 1) {
      rawArgStart += (argParts[partIndex]?.length ?? 0) + 1;
    }
    const trimOffset = rawArg.indexOf(arg);
    const start = token.start + openParen + 1 + rawArgStart + trimOffset;
    pushReferenceRange(
      references,
      rule.reference_kind as SymbolKind,
      arg,
      line,
      start,
      start + arg.length,
      refScope,
    );
  }
}
