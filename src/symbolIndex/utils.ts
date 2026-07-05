import { HaproxySchema, StatementRule } from "../schema";

import { scopedSymbolKindSet, symbolKeyForScopedKinds, SymbolSite } from "./types";

export function symbolNameTokenIndex(rule: StatementRule): number | null {
  if (rule.symbol_name_token_index != null) {
    return rule.symbol_name_token_index;
  }
  if (rule.value_token_index != null) {
    return rule.value_token_index;
  }
  const nameSlot = rule.fixed_slots?.find((slot) => slot.role === "name");
  if (nameSlot) {
    /* v8 ignore next -- malformed fixed-slot metadata may fail to round-trip its own index */
    const idx = rule.fixed_slots?.indexOf(nameSlot) ?? -1;
    /* v8 ignore next -- malformed fixed-slot metadata falls back to a null symbol-name index */
    return idx >= 0 ? idx + 1 : null;
  }
  return null;
}

export function addSite(
  schema: HaproxySchema,
  definitions: Map<string, SymbolSite[]>,
  references: SymbolSite[],
  site: SymbolSite,
): void {
  const key = symbolKeyForScopedKinds(
    scopedSymbolKindSet(schema),
    site.kind,
    site.name,
    site.scopeKey,
  );
  if (site.role === "definition") {
    const list = definitions.get(key) ?? [];
    list.push(site);
    definitions.set(key, list);
  } else {
    references.push(site);
  }
}

export function buildReferencesByKey(
  schema: HaproxySchema,
  references: SymbolSite[],
): Map<string, SymbolSite[]> {
  const map = new Map<string, SymbolSite[]>();
  const scopedKinds = scopedSymbolKindSet(schema);
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
