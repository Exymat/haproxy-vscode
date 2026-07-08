import {
  getWorkspaceSymbolIndex,
  isUriExcludedFromWorkspaceSymbols,
  isWorkspaceRebuildPending,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  workspaceEntryForDocument,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
  Uri,
} from "../../__mocks__/vscode";
import { createDocument, updateDocument } from "../../helpers/document";

import {
  buildWorkspace,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "./helpers";

describe("workspace open scope and uri targeting", () => {
  setupWorkspaceSymbolIndexTests();

  it("returns incremental scope when reopened content changed on disk", async () => {
    const content = "frontend web\n    use_backend api";
    setMockWorkspaceFile("file:///frontends/web.cfg", content);
    const doc = createDocument(content, "file:///frontends/web.cfg");
    mockTextDocuments.push(doc as never);
    await buildWorkspace();

    updateDocument(doc, "frontend web\n    use_backend renamed");
    expect(resolveWorkspaceRebuildScopeOnOpen(doc)).toBe("incremental");
  });

  it("reports pending rebuild state while debounced work is scheduled", async () => {
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      {
        enabled: true,
        include: ["**/*.cfg"],
        exclude: [],
        maxFiles: 1000,
        maxTotalLines: 100000,
        debounceMs: 1000,
      },
      4000,
      { scope: "content" },
    );
    expect(isWorkspaceRebuildPending()).toBe(true);
    await vi.runAllTimersAsync();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("does not treat URIs outside a workspace folder as excluded", () => {
    const settings = {
      enabled: true,
      include: ["**/*.cfg"],
      exclude: ["**/vendor/**"],
      maxFiles: 1000,
      maxTotalLines: 100000,
      debounceMs: 750,
    };
    const folder = {
      uri: Uri.file("file:///repo"),
      name: "repo",
      index: 0,
    };

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///outside/vendor/x.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(false);
  });

  it("falls back to content rebuild when incremental update hits a capped index", async () => {
    const doc = createDocument("backend api", "file:///api.cfg");
    mockTextDocuments.push(doc as never);
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      {
        enabled: true,
        include: ["**/*.cfg"],
        exclude: [],
        maxFiles: 0,
        maxTotalLines: 100000,
        debounceMs: 100,
      },
      4000,
      { scope: "full", document: doc },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    updateDocument(doc, "backend renamed");
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      {
        enabled: true,
        include: ["**/*.cfg"],
        exclude: [],
        maxFiles: 0,
        maxTotalLines: 100000,
        debounceMs: 100,
      },
      4000,
      { scope: "incremental", document: doc },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(workspaceEntryForDocument(doc)).toBeUndefined();
  });
});

describe("workspace uri-targeted rebuild", () => {
  setupWorkspaceSymbolIndexTests();

  it("rebuilds only the folder for a targeted uri", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///repo"), workspaceFolder("file:///other")]);
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    setMockWorkspaceFile("file:///other/b.cfg", "backend b");

    const repoDoc = createDocument("backend a", "file:///repo/a.cfg");
    mockTextDocuments.push(repoDoc as never);
    await buildWorkspace();

    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      {
        enabled: true,
        include: ["**/*.cfg"],
        exclude: [],
        maxFiles: 1000,
        maxTotalLines: 100000,
        debounceMs: 100,
      },
      4000,
      { scope: "content", uri: Uri.file("file:///repo/a.cfg") as never },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const index = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(index.documents.has("file:///repo/a.cfg")).toBe(true);
    expect(index.documents.has("file:///other/b.cfg")).toBe(false);
  });
});
