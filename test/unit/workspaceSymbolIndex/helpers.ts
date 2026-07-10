import {
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
  type WorkspaceSymbolIndex,
  type WorkspaceSymbolSettings,
} from "../../../src/symbolIndex";
import { resetMockVscode } from "../../helpers/vscode";
import { loadSchema } from "../../helpers/schema";

export const schema = loadSchema("3.4");

export const defaultWorkspaceSymbolSettings = (
  overrides: Partial<WorkspaceSymbolSettings> = {},
): WorkspaceSymbolSettings => ({
  enabled: true,
  include: ["**/*.cfg"],
  exclude: [],
  maxFiles: Number.POSITIVE_INFINITY,
  maxTotalLines: Number.POSITIVE_INFINITY,
  maxFileBytes: Number.POSITIVE_INFINITY,
  maxTotalBytes: Number.POSITIVE_INFINITY,
  maxLineBytes: Number.POSITIVE_INFINITY,
  debounceMs: 100,
  ...overrides,
});

export function pos(line: number, character: number) {
  return { line, character } as never;
}

export function workspaceFolder(uri: string) {
  return { uri: { fsPath: uri, toString: () => uri } };
}

export async function buildWorkspace(
  maxFiles = Number.POSITIVE_INFINITY,
  maxTotalLines = Number.POSITIVE_INFINITY,
  include = ["**/*.cfg"],
  overrides: Partial<WorkspaceSymbolSettings> = {},
) {
  scheduleWorkspaceSymbolIndexRebuild(
    schema,
    defaultWorkspaceSymbolSettings({ maxFiles, maxTotalLines, include, ...overrides }),
    4000,
  );
  await vi.runAllTimersAsync();
  await Promise.resolve();
  return getWorkspaceSymbolIndex();
}

export function expectWorkspaceIndex(index: WorkspaceSymbolIndex | null): WorkspaceSymbolIndex {
  expect(index).not.toBeNull();
  if (index === null) {
    throw new Error("expected workspace index");
  }
  return index;
}

export function expectWorkspaceDocumentSymbols(
  workspaceIndex: WorkspaceSymbolIndex,
  uriKey: string,
) {
  const symbols = workspaceIndex.documents.get(uriKey);
  expect(symbols).toBeDefined();
  if (symbols === undefined) {
    throw new Error("expected workspace document symbols");
  }
  return symbols;
}

export function setupWorkspaceSymbolIndexTests(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
    clearWorkspaceSymbolIndex();
  });

  afterEach(() => {
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });
}
