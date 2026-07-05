export { buildScopeKeyByLine, buildSymbolIndex } from "./build";
export { getSymbolIndex } from "./cache";
export { scopedSymbolKindSet, symbolKeyForSchema, symbolKeyForScopedKinds } from "./types";
export {
  findAllSites,
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  hasReferences,
  resolveSymbolAtPosition,
} from "./resolve";
export type { SymbolIndex, SymbolKind, SymbolSite } from "./types";
