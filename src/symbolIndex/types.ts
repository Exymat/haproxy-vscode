import { HaproxySchema, symbolStringList, symbolStringMap } from "../schema";

export type SymbolKind =
  | "proxy-section"
  | "defaults-profile"
  | "server"
  | "acl"
  | "filter"
  | "cache"
  | "userlist"
  | "resolvers"
  | "peers"
  | "environment-variable";

export interface SymbolSite {
  kind: SymbolKind;
  name: string;
  line: number;
  start: number;
  end: number;
  scopeKey: string | null;
  role: "definition" | "reference";
}

export interface SymbolIndex {
  definitions: Map<string, SymbolSite[]>;
  references: SymbolSite[];
  referencesByKey: Map<string, SymbolSite[]>;
  scopeKeyByLine: (string | null)[];
  scopedSymbolKinds: Set<SymbolKind>;
  /** Symbol sites indexed by line for O(1) position lookup. */
  sitesByLine: SymbolSite[][];
  /** Precomputed missing-reference sites; populated at index build. */
  unresolvedReferences: SymbolSite[];
}

const proxySectionCache = new WeakMap<HaproxySchema, Set<string>>();
const sectionDefinitionKindsCache = new WeakMap<HaproxySchema, Record<string, SymbolKind>>();
const scopedSymbolKindCache = new WeakMap<HaproxySchema, Set<SymbolKind>>();

export function proxySectionSet(schema: HaproxySchema): Set<string> {
  let cached = proxySectionCache.get(schema);
  if (!cached) {
    cached = new Set(symbolStringList(schema, "proxy_sections"));
    proxySectionCache.set(schema, cached);
  }
  return cached;
}

export function sectionDefinitionKinds(schema: HaproxySchema): Record<string, SymbolKind> {
  let cached = sectionDefinitionKindsCache.get(schema);
  if (!cached) {
    cached = symbolStringMap(schema, "section_definition_kinds") as Record<string, SymbolKind>;
    sectionDefinitionKindsCache.set(schema, cached);
  }
  return cached;
}

export function scopedSymbolKindSet(schema: HaproxySchema): Set<SymbolKind> {
  let cached = scopedSymbolKindCache.get(schema);
  if (!cached) {
    cached = new Set(symbolStringList(schema, "scoped_symbol_kinds") as SymbolKind[]);
    scopedSymbolKindCache.set(schema, cached);
  }
  return cached;
}

export function effectiveScopeKeyForSchema(
  schema: HaproxySchema,
  kind: SymbolKind,
  scopeKey: string | null,
): string | null {
  return scopedSymbolKindSet(schema).has(kind) ? scopeKey : null;
}

export function effectiveScopeKey(
  scopedKinds: Set<SymbolKind>,
  kind: SymbolKind,
  scopeKey: string | null,
): string | null {
  return scopedKinds.has(kind) ? scopeKey : null;
}

export function symbolKeyForScopedKinds(
  scopedKinds: Set<SymbolKind>,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): string {
  const lower = name.toLowerCase();
  if (scopeKey && scopedKinds.has(kind)) {
    return `${kind}:${scopeKey}:${lower}`;
  }
  return `${kind}:${lower}`;
}

export function symbolKeyForSchema(
  schema: HaproxySchema,
  kind: SymbolKind,
  name: string,
  scopeKey: string | null,
): string {
  return symbolKeyForScopedKinds(scopedSymbolKindSet(schema), kind, name, scopeKey);
}

export function proxyScopeKey(sectionType: string, sectionName: string): string {
  return `${sectionType}:${sectionName}`;
}
