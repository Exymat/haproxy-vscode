export { buildWorkspaceSymbolIndexFromOpenDocuments } from "./workspaceDocuments";
export { isUriExcludedFromWorkspaceSymbols } from "./workspaceDiscovery";
export {
  findAllWorkspaceSites,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  symbolIndexForWorkspaceDiagnostics,
  workspaceSiteRange,
  workspaceSiteText,
} from "./workspaceQueries";
export {
  clearWorkspaceSymbolIndex,
  isWorkspaceRebuildPending,
  refreshWorkspaceSymbolIndexNow,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
} from "./workspaceRebuild";
export type { WorkspaceSchemaSource } from "./workspaceRebuild";
export {
  getWorkspaceSymbolIndex,
  hasCappedWorkspaceFolders,
  isDocumentWorkspaceIndexCapped,
  workspaceEntryForDocument,
} from "./workspaceState";
export type {
  WorkspaceIndexChangeEvent,
  WorkspaceRebuildOptions,
  WorkspaceRebuildScope,
  WorkspaceSymbolIndex,
  WorkspaceSymbolSettings,
  WorkspaceSymbolSite,
} from "./workspaceTypes";
export { workspaceUriKey } from "./workspaceUri";
