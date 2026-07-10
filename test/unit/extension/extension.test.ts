import { activate, deactivate } from "../../../src/extension";
import { getLoadedBundle, invalidateBundleLoad } from "../../../src/extensionBundle";
import * as grammar from "../../../src/grammar";
import * as languageData from "../../../src/languageData";
import * as schema from "../../../src/schema/load";
import type { HaproxySchema } from "../../../src/schema/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastDiagnosticCollection,
  getRegisteredCommand,
  languages,
  mockTextDocuments,
  resetMockVscode,
  setMockConfig,
  setMockConfigForUri,
  setMockWorkspaceFolders,
  triggerMockConfigurationChange,
  triggerMockFolderConfigurationChange,
  window,
  workspace,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import { loadSchemaBundle } from "../../helpers/schema";

const fixture = loadSchemaBundle("3.2");

function haproxyDocument(content: string, lineCount?: number) {
  const lines = content.split(/\r?\n/);
  return {
    uri: { toString: () => "file:///test.cfg" },
    languageId: "haproxy",
    version: 1,
    lineCount: lineCount ?? lines.length,
    lineAt(lineNo: number) {
      return { text: lines[lineNo] ?? "" };
    },
    getText(range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    }) {
      if (!range) {
        return content;
      }
      const line = lines[range.start.line] ?? "";
      return line.slice(range.start.character, range.end.character);
    },
    positionAt(offset: number) {
      let remaining = offset;
      for (let i = 0; i < lines.length; i += 1) {
        const len = lines[i].length + 1;
        if (remaining <= len) {
          return { line: i, character: remaining };
        }
        remaining -= len;
      }
      return { line: lines.length - 1, character: 0 };
    },
  };
}

describe("extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
    deactivate();
  });

  afterEach(() => {
    deactivate();
    vi.useRealTimers();
  });

  it("activates and deactivates without error", () => {
    const context = mockExtensionContext();
    expect(getLoadedBundle()).toBeUndefined();
    expect(() => activate(context as never)).not.toThrow();
    expect(() => deactivate()).not.toThrow();
    expect(getLoadedBundle()).toBeUndefined();
  });

  it("schedules diagnostics for haproxy documents", async () => {
    const doc = haproxyDocument("frontend web\n    bind :80");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    await vi.waitFor(() => {
      expect(collection?.set).toHaveBeenCalled();
    });
  });

  it("skips diagnostics when disabled", async () => {
    const doc = haproxyDocument("frontend web\n    bind :80");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.enabled", false);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    expect(collection?.delete).toHaveBeenCalledWith(doc.uri);
  });

  it("clears diagnostics when document exceeds max lines", async () => {
    const doc = haproxyDocument("global", 5000);
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);
    setMockConfig("haproxy", "diagnostics.maxLines", 100);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    expect(collection?.set).toHaveBeenCalledWith(doc.uri, []);
  });

  it("formats document when format is enabled", async () => {
    let formatProvider:
      | {
          provideDocumentFormattingEdits: (
            doc: (typeof mockTextDocuments)[0],
          ) => Promise<unknown[]>;
        }
      | undefined;
    vi.spyOn(languages, "registerDocumentFormattingEditProvider").mockImplementation(
      (_selector, provider) => {
        formatProvider = provider as typeof formatProvider;
        return { provider, dispose: () => {} };
      },
    );

    const doc = haproxyDocument("frontend web\n      bind :443");
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    expect(formatProvider).toBeDefined();
    if (formatProvider === undefined) {
      throw new Error("format provider not registered");
    }
    const editsPromise = formatProvider.provideDocumentFormattingEdits(doc);
    await vi.runAllTimersAsync();
    const edits = await editsPromise;
    expect(edits.length).toBe(1);
    expect((edits[0] as { newText: string }).newText).toContain("bind :443");
  });

  it("awaits schema bundle before formatting section headers", async () => {
    let formatProvider:
      | {
          provideDocumentFormattingEdits: (
            doc: (typeof mockTextDocuments)[0],
          ) => Promise<unknown[]>;
        }
      | undefined;
    vi.spyOn(languages, "registerDocumentFormattingEditProvider").mockImplementation(
      (_selector, provider) => {
        formatProvider = provider as typeof formatProvider;
        return { provider, dispose: () => {} };
      },
    );

    const doc = haproxyDocument("    fcgi-app myapp\n        mode http");
    activate(mockExtensionContext() as never);

    expect(formatProvider).toBeDefined();
    if (formatProvider === undefined) {
      throw new Error("format provider not registered");
    }
    const editsPromise = formatProvider.provideDocumentFormattingEdits(doc);
    await vi.runAllTimersAsync();
    const edits = await editsPromise;
    expect(edits.length).toBe(1);
    expect((edits[0] as { newText: string }).newText).toBe("fcgi-app myapp\n    mode http");
  });

  it("reloads bundle on version configuration change", async () => {
    setMockWorkspaceFolders(undefined);
    setMockConfig("haproxy", "version", "3.2");
    setMockConfig("haproxy", "workspaceSymbols.enabled", false);
    vi.spyOn(grammar, "syncAllOpenDocumentGrammarLanguages").mockResolvedValue();
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    setMockConfig("haproxy", "version", "3.4");
    triggerMockConfigurationChange("haproxy.version");
    await vi.runAllTimersAsync();

    expect(getRegisteredCommand("haproxy.selectVersion")).toBeDefined();
  });

  it("syncs per-document grammar language on open and version change", async () => {
    const syncSpy = vi.spyOn(grammar, "syncDocumentGrammarLanguage").mockResolvedValue(true);
    const syncAllSpy = vi.spyOn(grammar, "syncAllOpenDocumentGrammarLanguages").mockResolvedValue();
    const doc = haproxyDocument("global");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "version", "3.2");
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    expect(syncSpy).toHaveBeenCalledWith(doc);

    syncSpy.mockClear();
    syncAllSpy.mockClear();

    setMockConfig("haproxy", "version", "3.4");
    triggerMockConfigurationChange("haproxy.version");
    await vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(syncAllSpy).toHaveBeenCalled();
    });

    syncSpy.mockRestore();
    syncAllSpy.mockRestore();
  });

  it("skips runDiagnostics for non-haproxy language after scheduling", async () => {
    vi.spyOn(grammar, "syncDocumentGrammarLanguage").mockResolvedValue(false);
    const doc = haproxyDocument("defaults\n    mode http");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);

    activate(mockExtensionContext() as never);
    await vi.advanceTimersByTimeAsync(0);
    (doc as { languageId: string }).languageId = "plaintext";
    await vi.advanceTimersByTimeAsync(100);

    const collection = getLastDiagnosticCollection();
    expect(collection?.set).not.toHaveBeenCalled();
  });

  it("clears pending diagnostics timer on document close", async () => {
    const doc = haproxyDocument("defaults\n    mode http");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 500);

    const closeListeners: Array<(d: typeof doc) => void> = [];
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.spyOn(workspace, "onDidCloseTextDocument").mockImplementation((listener) => {
      closeListeners.push(listener);
      return { dispose: () => {} };
    });

    activate(mockExtensionContext() as never);
    await vi.advanceTimersByTimeAsync(0);
    closeListeners[0](doc);

    const collection = getLastDiagnosticCollection();
    expect(collection?.delete).toHaveBeenCalledWith(doc.uri);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("re-schedules diagnostics on text document change", async () => {
    const doc = haproxyDocument("defaults\n    mode http");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 200);

    const changeListeners: Array<(event: { document: (typeof mockTextDocuments)[0] }) => void> = [];
    const origOnChange = workspace.onDidChangeTextDocument.bind(workspace);
    vi.spyOn(workspace, "onDidChangeTextDocument").mockImplementation((listener) => {
      changeListeners.push(listener);
      return origOnChange(listener);
    });

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    collection?.set.mockClear();

    expect(changeListeners.length).toBeGreaterThan(0);
    changeListeners[changeListeners.length - 1]({ document: doc });
    await vi.advanceTimersByTimeAsync(200);

    await vi.waitFor(() => {
      expect(collection?.set).toHaveBeenCalled();
    });
    vi.restoreAllMocks();
  });

  it("shows error and skips providers when bundle load fails", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("missing schema"));
    const doc = haproxyDocument("frontend web\n    bind :80");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);
    setMockConfig("haproxy", "workspaceSymbols.enabled", false);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("HAProxy extension failed to load schema"),
      );
    });

    const collection = getLastDiagnosticCollection();
    await vi.waitFor(() => {
      expect(collection?.set).toHaveBeenCalledWith(doc.uri, []);
    });
  });

  it("returns empty completion items when provider bundle loading fails", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue("provider string failure");
    let completionProvider:
      | {
          provideCompletionItems: (
            doc: (typeof mockTextDocuments)[0],
            position: unknown,
          ) => unknown;
        }
      | undefined;
    vi.spyOn(languages, "registerCompletionItemProvider").mockImplementation(
      (_selector, provider) => {
        completionProvider = provider as typeof completionProvider;
        return { provider, dispose: () => {} };
      },
    );

    const doc = haproxyDocument("frontend web\n    ");
    activate(mockExtensionContext() as never);

    expect(completionProvider).toBeDefined();
    if (completionProvider === undefined) {
      throw new Error("completion provider not registered");
    }
    const promise = completionProvider.provideCompletionItems(doc, { line: 1, character: 4 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([]);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("provider string failure"),
    );
  });

  it("returns empty completion items when provider bundle loading throws Error", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("provider error failure"));
    let completionProvider:
      | {
          provideCompletionItems: (
            doc: (typeof mockTextDocuments)[0],
            position: unknown,
          ) => unknown;
        }
      | undefined;
    vi.spyOn(languages, "registerCompletionItemProvider").mockImplementation(
      (_selector, provider) => {
        completionProvider = provider as typeof completionProvider;
        return { provider, dispose: () => {} };
      },
    );

    const doc = haproxyDocument("frontend web\n    ");
    activate(mockExtensionContext() as never);

    if (completionProvider === undefined) {
      throw new Error("completion provider not registered");
    }
    const promise = completionProvider.provideCompletionItems(doc, { line: 1, character: 4 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([]);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("provider error failure"),
    );
  });

  it("wraps non-Error bundle load failures on activation", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue("string-load-failure");
    mockTextDocuments.push(haproxyDocument("global"));
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("string-load-failure"),
      );
    });
  });

  it("shows scheduler bundle error when load fails after initial success", async () => {
    vi.restoreAllMocks();
    const doc = haproxyDocument("frontend web\n    bind :80");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);

    const changeListeners: Array<(event: { document: (typeof mockTextDocuments)[0] }) => void> = [];
    const origOnChange = workspace.onDidChangeTextDocument.bind(workspace);
    vi.spyOn(workspace, "onDidChangeTextDocument").mockImplementation((listener) => {
      changeListeners.push(listener);
      return origOnChange(listener);
    });

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(getLoadedBundle()).toBeDefined();
    });

    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("scheduler reload failed"));
    invalidateBundleLoad();
    vi.mocked(window.showErrorMessage).mockClear();

    changeListeners[changeListeners.length - 1]({ document: doc });
    await vi.advanceTimersByTimeAsync(200);

    await vi.waitFor(() => {
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("scheduler reload failed"),
      );
    });
    vi.restoreAllMocks();
  });

  it("clears pending diagnostic timers on deactivate", () => {
    const doc = haproxyDocument("defaults\n    mode http");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 5000);

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    activate(mockExtensionContext() as never);
    deactivate();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("skips reload when bundle load fails after version change", async () => {
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("missing schema"));
    setMockConfig("haproxy", "version", "3.4");
    triggerMockConfigurationChange("haproxy.version");
    await vi.runAllTimersAsync();

    await vi.waitFor(() => {
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("HAProxy extension failed to load schema"),
      );
    });
  });

  it("retries bundle load after a stale invalidation", async () => {
    let resolveSchema!: (value: HaproxySchema) => void;
    let schemaLoads = 0;
    vi.spyOn(schema, "loadSchemaAsync").mockImplementation(
      () =>
        new Promise((resolve) => {
          schemaLoads += 1;
          resolveSchema = resolve;
        }),
    );
    vi.spyOn(languageData, "loadLanguageDataAsync").mockResolvedValue(fixture.languageData);

    mockTextDocuments.push(haproxyDocument("global"));
    activate(mockExtensionContext() as never);
    await vi.advanceTimersByTimeAsync(0);

    invalidateBundleLoad("3.2");
    resolveSchema(fixture.schema);
    await vi.runAllTimersAsync();

    expect(schemaLoads).toBeGreaterThanOrEqual(2);
  });

  it("reloads bundle for a folder-scoped version change", async () => {
    setMockWorkspaceFolders([
      { uri: { toString: () => "file:///folder-a", fsPath: "/folder-a" } },
      { uri: { toString: () => "file:///folder-b", fsPath: "/folder-b" } },
    ]);
    setMockConfigForUri({ toString: () => "file:///folder-a" }, "haproxy", "version", "2.6");
    setMockConfigForUri({ toString: () => "file:///folder-b" }, "haproxy", "version", "3.4");
    setMockConfig("haproxy", "workspaceSymbols.enabled", true);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 10);

    const doc = {
      ...haproxyDocument("global"),
      uri: { toString: () => "file:///folder-a/app.cfg", fsPath: "/folder-a/app.cfg" },
    };
    mockTextDocuments.push(doc);

    vi.spyOn(grammar, "syncAllOpenDocumentGrammarLanguages").mockResolvedValue();
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    setMockConfigForUri({ toString: () => "file:///folder-a" }, "haproxy", "version", "3.0");
    triggerMockFolderConfigurationChange("haproxy.version", {
      folderUris: ["file:///folder-a"],
    });
    await vi.runAllTimersAsync();

    expect(getRegisteredCommand("haproxy.selectVersion")).toBeDefined();
  });
});
