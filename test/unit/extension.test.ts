import { activate, deactivate } from "../../src/extension";
import {
  getLastDiagnosticCollection,
  getRegisteredCommand,
  languages,
  mockTextDocuments,
  resetVscodeMock,
  setMockConfig,
  triggerMockConfigurationChange,
  workspace,
} from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";

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
    resetVscodeMock();
    deactivate();
  });

  afterEach(() => {
    deactivate();
    vi.useRealTimers();
  });

  it("activates and deactivates without error", () => {
    const context = mockExtensionContext();
    expect(() => activate(context as never)).not.toThrow();
    expect(() => deactivate()).not.toThrow();
  });

  it("schedules diagnostics for haproxy documents", async () => {
    const doc = haproxyDocument("frontend web\n    bind :80");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    expect(collection?.set).toHaveBeenCalled();
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
      | { provideDocumentFormattingEdits: (doc: (typeof mockTextDocuments)[0]) => unknown[] }
      | undefined;
    vi.spyOn(languages, "registerDocumentFormattingEditProvider").mockImplementation(
      (_selector, provider) => {
        formatProvider = provider as typeof formatProvider;
        return { dispose: () => {} };
      },
    );

    const doc = haproxyDocument("frontend web\n      bind :443");
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    expect(formatProvider).toBeDefined();
    if (formatProvider === undefined) {
      throw new Error("format provider not registered");
    }
    const edits = formatProvider.provideDocumentFormattingEdits(doc);
    expect(edits.length).toBe(1);
    expect((edits[0] as { newText: string }).newText).toContain("bind :443");
  });

  it("reloads bundle on version configuration change", async () => {
    setMockConfig("haproxy", "version", "3.2");
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    setMockConfig("haproxy", "version", "3.4");
    triggerMockConfigurationChange("haproxy.version");
    await vi.runAllTimersAsync();

    expect(getRegisteredCommand("haproxy.selectVersion")).toBeDefined();
  });

  it("skips runDiagnostics for non-haproxy language after scheduling", async () => {
    const doc = haproxyDocument("defaults\n    mode http");
    let languageId = "haproxy";
    Object.defineProperty(doc, "languageId", { get: () => languageId });
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 100);

    activate(mockExtensionContext() as never);
    languageId = "plaintext";
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

    expect(collection?.set).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
