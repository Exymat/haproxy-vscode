import { ParsedLine } from "../parser";

import { SymbolKind, SymbolSite } from "./types";

export function pushReference(
  references: SymbolSite[],
  kind: SymbolKind,
  name: string,
  line: ParsedLine,
  tokenIndex: number,
  scopeKey: string | null,
): void {
  const token = line.tokens[tokenIndex];
  references.push({
    kind,
    name,
    line: line.line,
    start: token.start,
    end: token.end,
    scopeKey,
    role: "reference",
  });
}

export function pushReferenceRange(
  references: SymbolSite[],
  kind: SymbolKind,
  name: string,
  line: ParsedLine,
  start: number,
  end: number,
  scopeKey: string | null,
): void {
  references.push({
    kind,
    name,
    line: line.line,
    start,
    end,
    scopeKey,
    role: "reference",
  });
}
