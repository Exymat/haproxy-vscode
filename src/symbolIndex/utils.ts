import { StatementRule } from "../schema";

import { SymbolIndex, SymbolKind, symbolKeyForScopedKinds, SymbolSite } from "./types";

export function symbolNameTokenIndex(rule: StatementRule): number | null {
  if (rule.symbol_name_token_index != null) {
    return rule.symbol_name_token_index;
  }
  if (rule.value_token_index != null) {
    return rule.value_token_index;
  }
  const nameSlot = rule.fixed_slots?.find((slot) => slot.role === "name");
  if (nameSlot) {
    return rule.fixed_slots!.indexOf(nameSlot) + 1;
  }
  return null;
}

export function addSite(
  scopedKinds: Set<SymbolKind>,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  site: SymbolSite,
): void {
  const key = symbolKeyForScopedKinds(scopedKinds, site.kind, site.name, site.scopeKey);
  if (site.role === "definition") {
    const list = definitions.get(key) ?? [];
    list.push(site);
    definitions.set(key, list);
  } else {
    references.push(site);
  }
}

export function buildSitesByLine(
  lineCount: number,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
): SymbolSite[][] {
  const sitesByLine: SymbolSite[][] = Array.from({ length: lineCount }, () => []);
  for (const site of references) {
    sitesByLine[site.line]?.push(site);
  }
  for (const defs of definitions.values()) {
    for (const site of defs) {
      sitesByLine[site.line]?.push(site);
    }
  }
  return sitesByLine;
}

export function buildReferencesByKey<T extends SymbolSite>(
  scopedKinds: Set<SymbolKind>,
  references: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const site of references) {
    const key = symbolKeyForScopedKinds(scopedKinds, site.kind, site.name, site.scopeKey);
    const list = map.get(key);
    if (list) {
      list.push(site);
    } else {
      map.set(key, [site]);
    }
  }
  return map;
}

export function ensureSitesByLine(index: SymbolIndex): void {
  if (index.sitesByLine.length === index.scopeKeyByLine.length) {
    return;
  }
  index.sitesByLine = buildSitesByLine(
    index.scopeKeyByLine.length,
    index.definitions,
    index.references,
  );
}
