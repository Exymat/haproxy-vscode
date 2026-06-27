export { buildScopeKeyByLine, buildSymbolIndex } from "./build";
export { getSymbolIndex } from "./cache";
export {
  findAllSites,
  findDefinitions,
  findReferences,
  hasReferences,
  resolveSymbolAtPosition,
} from "./resolve";
export type { SymbolIndex, SymbolKind, SymbolSite } from "./types";
export { symbolKey } from "./types";
