import * as symbolIndex from "../../src/symbolIndex";
import { activate, deactivate } from "../../src/extension";
import {
  getLastDiagnosticCollection,
  mockTextDocuments,
  resetVscodeMock,
  setMockConfig,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
  workspace,
  Uri,
} from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";
import { createDocument, updateDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";
import { workspaceFolder } from "./workspaceSymbolIndex/helpers";

const schema = loadSchema("3.4");
type MockDoc = (typeof mockTextDocuments)[number];

describe("extension workspace symbol integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetVscodeMock();
    deactivate();
  });

  afterEach(() => {
    deactivate();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ignores excluded watcher events", async () => {
    setMockConfig("haproxy", "workspaceSymbols.exclude", ["**/vendor/**"]);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 100);
    setMockWorkspaceFolders([workspaceFolder("file:///repo")]);

    const watchers: Array<{
      triggerCreate: (uri: unknown) => void;
      triggerChange: (uri: unknown) => void;
      triggerDelete: (uri: unknown) => void;
    }> = [];
    vi.spyOn(workspace, "createFileSystemWatcher").mockImplementation(() => {
      const watcher = {
        onDidCreate: (listener: (uri: unknown) => void) => {
          watcher.triggerCreate = listener;
          return { dispose: () => {} };
        },
        onDidChange: (listener: (uri: unknown) => void) => {
          watcher.triggerChange = listener;
          return { dispose: () => {} };
        },
        onDidDelete: (listener: (uri: unknown) => void) => {
          watcher.triggerDelete = listener;
          return { dispose: () => {} };
        },
        dispose: vi.fn(),
        triggerCreate: (_uri: unknown) => {},
        triggerChange: (_uri: unknown) => {},
        triggerDelete: (_uri: unknown) => {},
      };
      watchers.push(watcher);
      return watcher as never;
    });

    const findFilesSpy = vi.spyOn(workspace, "findFiles");
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();
    findFilesSpy.mockClear();

    watchers[0]?.triggerCreate(Uri.file("file:///repo/vendor/x.cfg"));
    await vi.runAllTimersAsync();
    expect(findFilesSpy).not.toHaveBeenCalled();
  });

  it("does not create workspace watchers when workspace symbols are disabled", () => {
    setMockConfig("haproxy", "workspaceSymbols.enabled", false);
    const watcherSpy = vi.spyOn(workspace, "createFileSystemWatcher");

    activate(mockExtensionContext() as never);

    expect(watcherSpy).not.toHaveBeenCalled();
    expect(symbolIndex.getWorkspaceSymbolIndex()).toBeNull();
  });

  it("rebuilds workspace symbols for non-excluded watcher events", async () => {
    setMockConfig("haproxy", "workspaceSymbols.exclude", ["**/vendor/**"]);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 100);
    setMockWorkspaceFolders([workspaceFolder("file:///repo")]);
    setMockWorkspaceFile("file:///repo/haproxy.cfg", "backend api");
    mockTextDocuments.push(createDocument("backend api", "file:///repo/existing.cfg") as never);

    const watchers: Array<{
      triggerCreate: (uri: unknown) => void;
      triggerChange: (uri: unknown) => void;
      triggerDelete: (uri: unknown) => void;
    }> = [];
    vi.spyOn(workspace, "createFileSystemWatcher").mockImplementation(() => {
      const watcher = {
        onDidCreate: (listener: (uri: unknown) => void) => {
          watcher.triggerCreate = listener;
          return { dispose: () => {} };
        },
        onDidChange: (listener: (uri: unknown) => void) => {
          watcher.triggerChange = listener;
          return { dispose: () => {} };
        },
        onDidDelete: (listener: (uri: unknown) => void) => {
          watcher.triggerDelete = listener;
          return { dispose: () => {} };
        },
        dispose: vi.fn(),
        triggerCreate: (_uri: unknown) => {},
        triggerChange: (_uri: unknown) => {},
        triggerDelete: (_uri: unknown) => {},
      };
      watchers.push(watcher);
      return watcher as never;
    });

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    watchers[0]?.triggerCreate(Uri.file("file:///repo/haproxy.cfg"));
    await vi.runAllTimersAsync();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(symbolIndex.getWorkspaceSymbolIndex()?.documents.has("file:///repo/haproxy.cfg")).toBe(
        true,
      );
    });

    watchers[0]?.triggerChange(Uri.file("file:///repo/haproxy.cfg"));
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(symbolIndex.getWorkspaceSymbolIndex()?.documents.has("file:///repo/haproxy.cfg")).toBe(
      true,
    );

    watchers[0]?.triggerDelete(Uri.file("file:///repo/haproxy.cfg"));
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(symbolIndex.getWorkspaceSymbolIndex()).not.toBeNull();
  });

  it("skips workspace rebuild when reopening unchanged indexed content", async () => {
    const openListeners: Array<(doc: MockDoc) => void> = [];
    vi.spyOn(workspace, "onDidOpenTextDocument").mockImplementation((listener) => {
      openListeners.push(listener);
      return { dispose: () => {} };
    });

    setMockWorkspaceFile("file:///test.cfg", "backend api");
    const doc = createDocument("backend api", "file:///test.cfg") as MockDoc;
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    openListeners.at(-1)?.(doc);
    await vi.runAllTimersAsync();

    openListeners.at(-1)?.(createDocument("backend api", "file:///test.cfg") as MockDoc);
    await vi.runAllTimersAsync();

    expect(symbolIndex.resolveWorkspaceRebuildScopeOnOpen(doc as never)).toBe("none");
    expect(symbolIndex.isWorkspaceRebuildPending()).toBe(false);
  });

  it("schedules incremental workspace rebuild when a haproxy document changes", async () => {
    const changeListeners: Array<(event: { document: MockDoc }) => void> = [];
    vi.spyOn(workspace, "onDidChangeTextDocument").mockImplementation((listener) => {
      changeListeners.push(listener);
      return {
        dispose: () => {},
        trigger(doc: MockDoc) {
          listener({ document: doc });
        },
      };
    });

    setMockWorkspaceFile("file:///test.cfg", "backend api");
    const doc = createDocument("backend api", "file:///test.cfg") as MockDoc;
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    updateDocument(doc as never, "backend renamed");
    changeListeners.at(-1)?.({ document: doc });
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(symbolIndex.isWorkspaceRebuildPending()).toBe(true);
    });
  });

  it("does not schedule workspace rebuild when a non-haproxy document changes", async () => {
    const changeListeners: Array<(event: { document: MockDoc }) => void> = [];
    vi.spyOn(workspace, "onDidChangeTextDocument").mockImplementation((listener) => {
      changeListeners.push(listener);
      return {
        dispose: () => {},
        trigger(doc: MockDoc) {
          listener({ document: doc });
        },
      };
    });

    const doc = createDocument("hello", "file:///notes.txt") as MockDoc;
    Object.defineProperty(doc, "languageId", { value: "plaintext" });
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    changeListeners.at(-1)?.({ document: doc });
    await Promise.resolve();

    expect(symbolIndex.isWorkspaceRebuildPending()).toBe(false);
  });

  it("schedules diagnostics and workspace content rebuilds when a haproxy document is saved", async () => {
    const saveListeners: Array<(doc: MockDoc) => void> = [];
    vi.spyOn(workspace, "onDidSaveTextDocument").mockImplementation((listener) => {
      saveListeners.push(listener);
      return { dispose: () => {} };
    });

    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 100);
    const doc = createDocument("backend api", "file:///saved.cfg") as MockDoc;
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    saveListeners.at(-1)?.(doc);
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(symbolIndex.isWorkspaceRebuildPending()).toBe(true);
    });

    symbolIndex.clearWorkspaceSymbolIndex();
    const plain = createDocument("hello", "file:///saved.txt") as MockDoc;
    Object.defineProperty(plain, "languageId", { value: "plaintext" });
    saveListeners.at(-1)?.(plain);
    await Promise.resolve();

    expect(symbolIndex.isWorkspaceRebuildPending()).toBe(false);
  });

  it("runs diagnostics immediately when reopening a warm cached document", async () => {
    const openListeners: Array<(doc: MockDoc) => void> = [];
    vi.spyOn(workspace, "onDidOpenTextDocument").mockImplementation((listener) => {
      openListeners.push(listener);
      return { dispose: () => {} };
    });

    setMockWorkspaceFile("file:///test.cfg", "backend api");
    const first = createDocument("backend api", "file:///test.cfg") as MockDoc;
    mockTextDocuments.push(first);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    collection?.set.mockClear();

    const reopened = createDocument("backend api", "file:///test.cfg") as MockDoc;
    openListeners.at(-1)?.(reopened);
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(collection?.set).toHaveBeenCalled();
    });
  });

  it("runs diagnostics immediately after incremental workspace index updates", async () => {
    setMockWorkspaceFile("file:///api.cfg", "backend api");
    const doc = createDocument("backend api", "file:///api.cfg");
    mockTextDocuments.push(doc as never);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    symbolIndex.scheduleWorkspaceSymbolIndexRebuild(
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
      { scope: "full" },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const collection = getLastDiagnosticCollection();
    collection?.set.mockClear();

    updateDocument(doc, "backend renamed");
    symbolIndex.scheduleWorkspaceSymbolIndexRebuild(
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
      { scope: "incremental", document: doc },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(collection?.set).toHaveBeenCalled();
  });

  it("refreshes all documents after full workspace rebuilds", async () => {
    setMockWorkspaceFile("file:///api.cfg", "backend api");
    const doc = createDocument("backend api", "file:///api.cfg");
    mockTextDocuments.push(doc as never);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    collection?.set.mockClear();

    setMockWorkspaceFile("file:///other.cfg", "backend other");
    symbolIndex.scheduleWorkspaceSymbolIndexRebuild(
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
      { scope: "full" },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(collection?.set).toHaveBeenCalled();
  });
});
