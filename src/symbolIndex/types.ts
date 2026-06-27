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
}

export const PROXY_SECTIONS = new Set(["frontend", "backend", "listen"]);

export const SECTION_DEFINITION_KINDS: Record<string, SymbolKind> = {
  frontend: "proxy-section",
  backend: "proxy-section",
  listen: "proxy-section",
  defaults: "defaults-profile",
  cache: "cache",
  userlist: "userlist",
  resolvers: "resolvers",
  peers: "peers",
};

export const SCOPED_SYMBOL_KINDS = new Set<SymbolKind>(["server", "acl", "filter"]);

export function effectiveScopeKey(kind: SymbolKind, scopeKey: string | null): string | null {
  return SCOPED_SYMBOL_KINDS.has(kind) ? scopeKey : null;
}

export function symbolKey(kind: SymbolKind, name: string, scopeKey: string | null): string {
  const lower = name.toLowerCase();
  if (scopeKey && SCOPED_SYMBOL_KINDS.has(kind)) {
    return `${kind}:${scopeKey}:${lower}`;
  }
  return `${kind}:${lower}`;
}

export function proxyScopeKey(sectionType: string, sectionName: string): string {
  return `${sectionType}:${sectionName}`;
}
