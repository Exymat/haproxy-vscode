export { fingerprintText } from "../contentFingerprint";
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
  listDefinitionNames,
  resolveExpectedSymbolReferenceAtCompletion,
} from "./expectedReference";
export type { ExpectedSymbolReference } from "./expectedReference";
export {
  clearWorkspaceSymbolIndex,
  buildWorkspaceSymbolIndexFromOpenDocuments,
  findAllWorkspaceSites,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getWorkspaceSymbolIndex,
  hasCappedWorkspaceFolders,
  isDocumentWorkspaceIndexCapped,
  isUriExcludedFromWorkspaceSymbols,
  isWorkspaceRebuildPending,
  refreshWorkspaceSymbolIndexNow,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  symbolIndexForWorkspaceDiagnostics,
  workspaceEntryForDocument,
  workspaceUriKey,
  workspaceSiteRange,
  workspaceSiteText,
} from "./workspace";
export type { SymbolIndex, SymbolKind, SymbolSite } from "./types";
export type {
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildOptions,
  WorkspaceRebuildScope,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
  WorkspaceSymbolSite,
} from "./workspace";
export { invalidateDiscoveryCache } from "./workspaceDiscovery";
