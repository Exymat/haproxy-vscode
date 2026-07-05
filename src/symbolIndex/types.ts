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
  | "peers";

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
}

export function proxySectionSet(schema: HaproxySchema): Set<string> {
  return new Set(symbolStringList(schema, "proxy_sections"));
}

export function sectionDefinitionKinds(schema: HaproxySchema): Record<string, SymbolKind> {
  return symbolStringMap(schema, "section_definition_kinds") as Record<string, SymbolKind>;
}

export function scopedSymbolKindSet(schema: HaproxySchema): Set<SymbolKind> {
  return new Set(symbolStringList(schema, "scoped_symbol_kinds") as SymbolKind[]);
}

export function effectiveScopeKeyForSchema(
  schema: HaproxySchema,
  kind: SymbolKind,
  scopeKey: string | null,
): string | null {
  return scopedSymbolKindSet(schema).has(kind) ? scopeKey : null;
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
