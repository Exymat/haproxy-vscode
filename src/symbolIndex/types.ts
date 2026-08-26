/** Core symbol-site and symbol-index types and key helpers. */
import { HaproxySchema } from "../schema/types";
import { symbolKindMap, symbolKindSet, symbolStringList } from "../schema/symbols";
import { SymbolKind } from "../core/editorKinds";

export type { SymbolKind } from "../core/editorKinds";

export type ProxyCapability = "frontend" | "backend";

const FRONTEND_CAPABILITY = ["frontend"] as const;
const BACKEND_CAPABILITY = ["backend"] as const;
const LISTEN_CAPABILITIES = ["frontend", "backend"] as const;

export interface SymbolSite {
  kind: SymbolKind;
  name: string;
  line: number;
  start: number;
  end: number;
  scopeKey: string | null;
  role: "definition" | "reference";
  /** Proxy capabilities supplied by a section or required by a reference. */
  proxyCapabilities?: readonly ProxyCapability[];
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
    cached = symbolKindMap(schema, "section_definition_kinds");
    sectionDefinitionKindsCache.set(schema, cached);
  }
  return cached;
}

export function scopedSymbolKindSet(schema: HaproxySchema): Set<SymbolKind> {
  let cached = scopedSymbolKindCache.get(schema);
  if (!cached) {
    cached = symbolKindSet(schema, "scoped_symbol_kinds");
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
  if (scopeKey && scopedKinds.has(kind)) {
    return `${kind}:${scopeKey}:${name}`;
  }
  return `${kind}:${name}`;
}

export function proxyCapabilitiesForSectionType(
  sectionType: string,
): readonly ProxyCapability[] | undefined {
  if (sectionType === "listen") {
    return LISTEN_CAPABILITIES;
  }
  if (sectionType === "frontend") {
    return FRONTEND_CAPABILITY;
  }
  if (sectionType === "backend") {
    return BACKEND_CAPABILITY;
  }
  return undefined;
}

export function proxyCapabilitiesForReference(
  kind: SymbolKind,
  keyword: string | undefined,
): readonly ProxyCapability[] | undefined {
  const normalizedKeyword = keyword?.toLowerCase();
  if (
    kind === "proxy-section" &&
    (normalizedKeyword === "use_backend" || normalizedKeyword === "default_backend")
  ) {
    return BACKEND_CAPABILITY;
  }
  return undefined;
}

export function proxyCapabilitiesOverlap(
  left: readonly ProxyCapability[] | undefined,
  right: readonly ProxyCapability[] | undefined,
): boolean {
  return left === undefined || right === undefined || left.some((value) => right.includes(value));
}

export function siteMatchesProxyCapabilities(
  site: Pick<SymbolSite, "kind" | "proxyCapabilities">,
  requested: readonly ProxyCapability[] | undefined,
): boolean {
  return (
    site.kind !== "proxy-section" || proxyCapabilitiesOverlap(site.proxyCapabilities, requested)
  );
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
