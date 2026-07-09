import {
  findWorkspaceDefinitions,
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
  workspace,
} from "../../__mocks__/vscode";
import { createDocument, updateDocument } from "../../helpers/document";

import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
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
      defaultWorkspaceSymbolSettings({ debounceMs: 1000 }),
      4000,
      { scope: "content" },
    );
    expect(isWorkspaceRebuildPending()).toBe(true);
    await vi.runAllTimersAsync();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("does not treat URIs outside a workspace folder as excluded", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["**/vendor/**"],
      debounceMs: 750,
    });
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
    const content = "backend api";
    setMockWorkspaceFile("file:///api.cfg", content);
    setMockWorkspaceFile("file:///other.cfg", "backend other");
    const doc = createDocument(content, "file:///api.cfg");
    mockTextDocuments.push(doc as never);
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({ maxFiles: 1 }),
      4000,
      { scope: "full", document: doc },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    updateDocument(doc, "backend renamed");
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({ maxFiles: 1 }),
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

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "content",
      uri: Uri.file("file:///repo/a.cfg") as never,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const index = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(index.documents.has("file:///repo/a.cfg")).toBe(true);
    expect(index.documents.has("file:///other/b.cfg")).toBe(false);
  });
});

describe("workspace debounced burst rebuilds", () => {
  setupWorkspaceSymbolIndexTests();

  const settings = defaultWorkspaceSymbolSettings({ debounceMs: 100 });

  it("rebuilds both folders when two content uri events land before debounce", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///repo"), workspaceFolder("file:///other")]);
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    setMockWorkspaceFile("file:///other/b.cfg", "backend b");

    const repoDoc = createDocument("backend a", "file:///repo/a.cfg");
    const otherDoc = createDocument("backend b", "file:///other/b.cfg");
    mockTextDocuments.push(repoDoc as never, otherDoc as never);
    await buildWorkspace();

    setMockWorkspaceFile("file:///repo/a.cfg", "backend a_v2");
    setMockWorkspaceFile("file:///other/b.cfg", "backend b_v2");
    updateDocument(repoDoc, "backend a_v2");
    updateDocument(otherDoc, "backend b_v2");

    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "content",
      uri: Uri.file("file:///repo/a.cfg") as never,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "content",
      uri: Uri.file("file:///other/b.cfg") as never,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const repoIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex(repoDoc));
    const otherIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex(otherDoc));
    expect(findWorkspaceDefinitions(repoIndex, "proxy-section", "a_v2", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(otherIndex, "proxy-section", "b_v2", null)).toHaveLength(1);
  });

  it("applies both incremental document updates before debounce fires", async () => {
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    setMockWorkspaceFile("file:///backends/api.cfg", "backend api");

    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///frontends/web.cfg",
    );
    const backend = createDocument("backend api", "file:///backends/api.cfg");
    mockTextDocuments.push(frontend as never, backend as never);
    await buildWorkspace();

    updateDocument(frontend, "frontend web\n    use_backend api_v2");
    updateDocument(backend, "backend api_v2");

    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "incremental",
      document: frontend,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "incremental",
      document: backend,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex(frontend));
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api_v2", null)).toHaveLength(
      1,
    );
    expect(workspaceIndex.referencesByKey.get("proxy-section:api_v2") ?? []).not.toHaveLength(0);
  });

  it("runs a full rebuild when full scope follows a targeted content event", async () => {
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    setMockWorkspaceFile("file:///repo/b.cfg", "backend b");
    await buildWorkspace();

    setMockWorkspaceFile("file:///repo/c.cfg", "backend c");

    const findFilesSpy = vi.spyOn(workspace, "findFiles");
    findFilesSpy.mockClear();

    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "content",
      uri: Uri.file("file:///repo/a.cfg") as never,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, { scope: "full" });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(findFilesSpy).toHaveBeenCalled();
    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(workspaceIndex.documents.has("file:///repo/c.cfg")).toBe(true);
  });

  it("ignores incremental scope events that omit a document", async () => {
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    await buildWorkspace();

    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, { scope: "incremental" });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(
      expectWorkspaceIndex(getWorkspaceSymbolIndex())?.documents.has("file:///repo/a.cfg"),
    ).toBe(true);
  });

  it("drops incremental pending work when a full folder target is already queued", async () => {
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    const doc = createDocument("backend a", "file:///repo/a.cfg");
    mockTextDocuments.push(doc as never);
    await buildWorkspace();

    updateDocument(doc, "backend renamed");

    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "full",
      uri: Uri.file("file:///repo/a.cfg") as never,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const index = expectWorkspaceIndex(getWorkspaceSymbolIndex(doc));
    expect(findWorkspaceDefinitions(index, "proxy-section", "renamed", null)).toHaveLength(1);
  });

  it("clears pending incrementals when a full folder target is merged", async () => {
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    setMockWorkspaceFile("file:///repo/b.cfg", "backend b");
    const docA = createDocument("backend a", "file:///repo/a.cfg");
    const docB = createDocument("backend b", "file:///repo/b.cfg");
    mockTextDocuments.push(docA as never, docB as never);
    await buildWorkspace();

    updateDocument(docA, "backend a_v2");

    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "incremental",
      document: docA,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "full",
      uri: Uri.file("file:///repo/b.cfg") as never,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const index = expectWorkspaceIndex(getWorkspaceSymbolIndex(docA));
    expect(findWorkspaceDefinitions(index, "proxy-section", "a_v2", null)).toHaveLength(1);
    expect(index.documents.has("file:///repo/b.cfg")).toBe(true);
  });

  it("keeps single incremental rebuilds off the findFiles path", async () => {
    setMockWorkspaceFile("file:///backends/other.cfg", "backend other");
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    const doc = createDocument("frontend web\n    use_backend api", "file:///frontends/web.cfg");
    mockTextDocuments.push(doc as never);
    await buildWorkspace();

    const findFilesSpy = vi.spyOn(workspace, "findFiles");
    findFilesSpy.mockClear();

    updateDocument(doc, "frontend web\n    use_backend renamed");
    scheduleWorkspaceSymbolIndexRebuild(schema, settings, 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(findFilesSpy).not.toHaveBeenCalled();
    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(workspaceIndex.referencesByKey.get("proxy-section:renamed") ?? []).not.toHaveLength(0);
  });
});
