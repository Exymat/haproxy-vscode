import { describe, expect, it, vi } from "vitest";

import { registerExtensionLifecycle } from "../../../src/extension/extensionLifecycle";
import * as grammar from "../../../src/extension/grammar";
import { getExtensionSettings } from "../../../src/extension/settings";
import * as documentCache from "../../../src/parser/documentCache";
import {
  languages,
  mockTextDocuments,
  resetMockVscode,
  setMockConfigForUri,
  setMockWorkspaceFolders,
  triggerMockCloseTextDocument,
  triggerMockFolderConfigurationChange,
  triggerMockOpenTextDocument,
  triggerMockTextDocumentChange,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import { loadSchemaBundle } from "../../helpers/schema";
import { defaultWorkspaceSymbolSettings, workspaceFolder } from "../workspaceSymbolIndex/helpers";

const bundle = { version: "3.4", edition: "community" as const, ...loadSchemaBundle("3.4") };

describe("extension lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules folder-scoped workspace rebuilds after folder version changes", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///folder-a")]);
    setMockConfigForUri({ toString: () => "file:///folder-a" }, "haproxy", "version", "3.4");
    vi.spyOn(grammar, "syncAllOpenDocumentGrammarLanguages").mockResolvedValue();
    const scheduleForUri = vi.fn((_uri: unknown, _scope: string) => Promise.resolve());
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri,
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle: vi.fn(),
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    triggerMockFolderConfigurationChange("haproxy.version", {
      folderUris: ["file:///folder-a"],
    });
    await vi.runAllTimersAsync();

    const firstCall = scheduleForUri.mock.calls[0];
    expect(firstCall?.[1]).toBe("full");
    const uri = firstCall?.[0] as { toString: () => string } | undefined;
    expect(uri?.toString()).toBe("file:///folder-a");
  });

  it("does not index the workspace on activation when no HAProxy document is open", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///folder-a")]);
    const scheduleRebuildWithReadyBundle = vi.fn();
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri: vi.fn(),
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle,
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    await vi.runAllTimersAsync();
    expect(scheduleRebuildWithReadyBundle).not.toHaveBeenCalled();
  });

  it("skips workspace indexing on activation when the schema bundle is unavailable", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///folder-a")]);
    mockTextDocuments.push({
      uri: { toString: () => "file:///folder-a/haproxy.cfg", scheme: "file" },
      languageId: "haproxy",
      version: 1,
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
    } as never);
    const scheduleRebuildWithReadyBundle = vi.fn();
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(undefined)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri: vi.fn(),
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle,
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    await vi.runAllTimersAsync();
    expect(scheduleRebuildWithReadyBundle).not.toHaveBeenCalled();
  });

  it("indexes the workspace on activation when a HAProxy document is already open", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///folder-a")]);
    mockTextDocuments.push({
      uri: { toString: () => "file:///folder-a/haproxy.cfg", scheme: "file" },
      languageId: "haproxy",
      version: 1,
      lineCount: 1,
      lineAt: () => ({ text: "global" }),
      getText: () => "global",
    } as never);
    const scheduleRebuildWithReadyBundle = vi.fn();
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri: vi.fn(),
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle,
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    await vi.runAllTimersAsync();
    expect(scheduleRebuildWithReadyBundle).toHaveBeenCalledWith("full");
  });

  it("does not index on activation when there are no workspace folders or HAProxy documents", async () => {
    const scheduleRebuildWithReadyBundle = vi.fn();
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri: vi.fn(),
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle,
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    await vi.runAllTimersAsync();
    expect(scheduleRebuildWithReadyBundle).not.toHaveBeenCalled();
  });

  it("runs diagnostics immediately when a reopened document has a warm URI cache", () => {
    vi.spyOn(grammar, "syncDocumentGrammarLanguage").mockResolvedValue(true);
    vi.spyOn(documentCache, "hasWarmUriDocumentCache").mockReturnValue(true);
    const diagnostics = {
      scheduler: {
        schedule: vi.fn(),
        runNow: vi.fn(),
        disposeDocument: vi.fn(),
        clearPending: vi.fn(),
      },
      refreshAllDocuments: vi.fn(),
      refreshDocumentsInWorkspaceFolders: vi.fn(),
      dispose: vi.fn(),
    };

    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics,
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri: vi.fn(),
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle: vi.fn(),
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });

    const doc = {
      uri: { toString: () => "file:///warm.cfg" },
      languageId: "haproxy",
      version: 1,
      lineCount: 1,
      lineAt: () => ({ text: "backend api" }),
      getText: () => "backend api",
    };
    mockTextDocuments.push(doc as never);
    triggerMockOpenTextDocument(doc as never);
    expect(diagnostics.scheduler.runNow).toHaveBeenCalledWith(doc);
  });
});

describe("plaintext language promotion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
    vi.mocked(languages.setTextDocumentLanguage).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function registerLifecycle(): void {
    registerExtensionLifecycle({
      context: mockExtensionContext() as never,
      extensionVersion: "test",
      getSettings: getExtensionSettings,
      refreshSettings: vi.fn(),
      diagnostics: {
        scheduler: {
          schedule: vi.fn(),
          runNow: vi.fn(),
          disposeDocument: vi.fn(),
          clearPending: vi.fn(),
        },
        refreshAllDocuments: vi.fn(),
        refreshDocumentsInWorkspaceFolders: vi.fn(),
        dispose: vi.fn(),
      },
      bundle: {
        ensureBundleResilient: vi.fn(() => Promise.resolve(bundle)),
        safeEnsureBundle: vi.fn(() => Promise.resolve(bundle)),
        resolveWorkspaceSchema: vi.fn(() => Promise.resolve(bundle.schema)),
        invalidate: vi.fn(),
        reportBundleError: vi.fn(),
        resetErrorReporting: vi.fn(),
        dispose: vi.fn(),
      },
      workspaceSymbols: {
        settings: () => defaultWorkspaceSymbolSettings(),
        scheduleForUri: vi.fn(),
        schedule: vi.fn(() => Promise.resolve()),
        scheduleRebuildWithReadyBundle: vi.fn(),
        configureWatchers: vi.fn(),
        handleWorkspaceFoldersChanged: vi.fn(),
      } as never,
    });
  }

  function plaintextDocument(content: string, uri = "file:///sample.txt", scheme = "file") {
    const lines = content.split("\n");
    return {
      uri: { scheme, toString: () => uri },
      languageId: "plaintext",
      version: 1,
      get lineCount() {
        return lines.length;
      },
      lineAt: (index: number) => ({ text: lines[index] ?? "" }),
      getText: () => lines.join("\n"),
      setContent(next: string) {
        lines.splice(0, lines.length, ...next.split("\n"));
      },
    };
  }

  it("promotes plaintext when the first section is a frontend", async () => {
    registerLifecycle();
    const doc = plaintextDocument("# comment\nfrontend fe\n");

    triggerMockOpenTextDocument(doc as never);
    await Promise.resolve();

    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy");
  });

  it("promotes a plaintext document that was already open at activation", async () => {
    const doc = plaintextDocument("backend api\n");
    mockTextDocuments.push(doc as never);

    registerLifecycle();
    await Promise.resolve();

    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy");
  });

  it("leaves nginx-like plaintext and non-file documents alone", async () => {
    registerLifecycle();
    const nginx = plaintextDocument("server { listen 80; }\n");
    const output = plaintextDocument("frontend fe\n", "output://log", "output");
    const ini = plaintextDocument("frontend fe\n", "file:///app.ini");
    ini.languageId = "ini";

    triggerMockOpenTextDocument(nginx as never);
    triggerMockOpenTextDocument(output as never);
    triggerMockOpenTextDocument(ini as never);
    await Promise.resolve();

    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });

  it("promotes a plaintext edit only after the witness line appears", async () => {
    registerLifecycle();
    const doc = plaintextDocument("global\n");

    triggerMockTextDocumentChange(doc as never);
    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();

    doc.setContent("global\n    maxconn 2000\n");
    triggerMockTextDocumentChange(doc as never);
    await Promise.resolve();

    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy");
  });

  it("does not promote again after the user switches the document back to plaintext", async () => {
    registerLifecycle();
    const doc = plaintextDocument("frontend web\n", "file:///web.cfg");

    triggerMockOpenTextDocument(doc as never);
    await Promise.resolve();
    expect(languages.setTextDocumentLanguage).toHaveBeenCalledWith(doc, "haproxy");
    vi.mocked(languages.setTextDocumentLanguage).mockClear();

    triggerMockCloseTextDocument(doc as never);
    doc.languageId = "plaintext";
    triggerMockOpenTextDocument(doc as never);
    await Promise.resolve();

    expect(languages.setTextDocumentLanguage).not.toHaveBeenCalled();
  });
});
