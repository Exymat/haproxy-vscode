export {
  buildScopeKeyByLine,
  buildSymbolIndex,
  buildSymbolIndexWithFingerprints,
  patchSymbolIndexLine,
} from "./build";
export { getSymbolIndex, getSymbolIndexVersion } from "./cache";
export { scopedSymbolKindSet, symbolKeyForSchema, symbolKeyForScopedKinds } from "./types";
export {
  findAllSites,
  findDefinitions,
  findReferences,
  findSiteAtPosition,
  hasReferences,
  resolveSymbolAtPosition,
} from "./resolve";
export {
  clearWorkspaceSymbolIndex,
  buildWorkspaceSymbolIndexFromOpenDocuments,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getWorkspaceSymbolIndex,
  refreshWorkspaceSymbolIndexNow,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  symbolIndexForWorkspaceDiagnostics,
  workspaceUriKey,
  workspaceSiteRange,
} from "./workspace";
export type { SymbolIndex, SymbolKind, SymbolSite } from "./types";
export type {
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
  WorkspaceSymbolSite,
} from "./workspace";
