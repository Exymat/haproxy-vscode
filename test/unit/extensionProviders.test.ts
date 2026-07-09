import { activate, deactivate } from "../../src/extension";
import * as schema from "../../src/schema";
import {
  commands,
  getRegisteredCommand,
  getLastDiagnosticCollection,
  languages,
  mockTextDocuments,
  resetVscodeMock,
  setMockConfig,
  workspace,
} from "../__mocks__/vscode";
import { mockExtensionContext } from "../helpers/extensionContext";

function haproxyDocument(content: string) {
  const lines = content.split(/\r?\n/);
  return {
    uri: { toString: () => "file:///test.cfg" },
    languageId: "haproxy",
    version: 1,
    lineCount: lines.length,
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
    getWordRangeAtPosition(position: { line: number; character: number }, _pattern?: RegExp) {
      const line = lines[position.line] ?? "";
      const before = line.slice(0, position.character);
      const match = before.match(/([a-zA-Z0-9_.-]+)$/);
      if (!match?.[1]) {
        return undefined;
      }
      const start = position.character - match[1].length;
      return {
        start: { line: position.line, character: start },
        end: { line: position.line, character: position.character },
      };
    },
  };
}

describe("extension providers", () => {
  let capturedProviders: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetVscodeMock();
    deactivate();
    capturedProviders = {};

    vi.spyOn(languages, "registerCompletionItemProvider").mockImplementation((_s, provider) => {
      capturedProviders.completion = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerHoverProvider").mockImplementation((_s, provider) => {
      capturedProviders.hover = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerDefinitionProvider").mockImplementation((_s, provider) => {
      capturedProviders.definition = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerReferenceProvider").mockImplementation((_s, provider) => {
      capturedProviders.references = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerRenameProvider").mockImplementation((_s, provider) => {
      capturedProviders.rename = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerDocumentSymbolProvider").mockImplementation((_s, provider) => {
      capturedProviders.symbols = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerFoldingRangeProvider").mockImplementation((_s, provider) => {
      capturedProviders.folding = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerDocumentFormattingEditProvider").mockImplementation(
      (_s, provider) => {
        capturedProviders.format = provider;
        return { provider, dispose: () => {} };
      },
    );
  });

  afterEach(() => {
    deactivate();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("invokes registered language providers", async () => {
    const doc = haproxyDocument(
      "global\n    maxconn 100\ndefaults\n    mode http\nfrontend web\n    bind :80\nbackend api\n    server s1 127.0.0.1:8080\n    balance roundrobin",
    );
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const completion = capturedProviders.completion as {
      provideCompletionItems: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const hover = capturedProviders.hover as {
      provideHover: (doc: unknown, pos: { line: number; character: number }) => Promise<unknown>;
    };
    const definition = capturedProviders.definition as {
      provideDefinition: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const references = capturedProviders.references as {
      provideReferences: (
        doc: unknown,
        pos: { line: number; character: number },
        ctx: { includeDeclaration: boolean },
      ) => Promise<unknown>;
    };
    const rename = capturedProviders.rename as {
      prepareRename: (doc: unknown, pos: { line: number; character: number }) => Promise<unknown>;
      provideRenameEdits: (
        doc: unknown,
        pos: { line: number; character: number },
        name: string,
      ) => Promise<unknown>;
    };
    const symbols = capturedProviders.symbols as {
      provideDocumentSymbols: (doc: unknown) => unknown;
    };
    const folding = capturedProviders.folding as {
      provideFoldingRanges: (doc: unknown) => unknown;
    };

    await completion.provideCompletionItems(doc, { line: 1, character: 4 });
    await hover.provideHover(doc, { line: 4, character: 6 });
    await definition.provideDefinition(doc, { line: 4, character: 6 });
    await references.provideReferences(
      doc,
      { line: 4, character: 6 },
      { includeDeclaration: true },
    );
    await rename.prepareRename(doc, { line: 6, character: "backend ".length });
    await rename.provideRenameEdits(doc, { line: 6, character: "backend ".length }, "api_v2");
    expect(symbols.provideDocumentSymbols(doc)).toBeDefined();
    expect(folding.provideFoldingRanges(doc)).toBeDefined();
  });

  it("runs the internal peek definition command", async () => {
    const doc = haproxyDocument("backend api\nfrontend web\n    use_backend api");
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const command = getRegisteredCommand("haproxy.peekDefinitionAtPosition");
    expect(command).toBeDefined();
    await command?.("file:///test.cfg", 2, "    use_backend ".length);
    expect(commands.executeCommand).toHaveBeenCalledWith("editor.action.peekDefinition");
  });

  it("returns empty results when bundle load fails", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("missing schema"));
    const doc = haproxyDocument("defaults\n    mode http");

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const completion = capturedProviders.completion as {
      provideCompletionItems: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const hover = capturedProviders.hover as {
      provideHover: (doc: unknown, pos: { line: number; character: number }) => Promise<unknown>;
    };
    const definition = capturedProviders.definition as {
      provideDefinition: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const references = capturedProviders.references as {
      provideReferences: (
        doc: unknown,
        pos: { line: number; character: number },
        ctx: { includeDeclaration: boolean },
      ) => Promise<unknown>;
    };
    const rename = capturedProviders.rename as {
      prepareRename: (doc: unknown, pos: { line: number; character: number }) => Promise<unknown>;
      provideRenameEdits: (
        doc: unknown,
        pos: { line: number; character: number },
        name: string,
      ) => Promise<unknown>;
    };

    expect(await completion.provideCompletionItems(doc, { line: 1, character: 4 })).toEqual([]);
    expect(await hover.provideHover(doc, { line: 1, character: 4 })).toBeNull();
    expect(await definition.provideDefinition(doc, { line: 1, character: 4 })).toBeNull();
    expect(
      await references.provideReferences(
        doc,
        { line: 1, character: 4 },
        { includeDeclaration: true },
      ),
    ).toEqual([]);
    expect(await rename.prepareRename(doc, { line: 1, character: 4 })).toBeNull();
    expect(await rename.provideRenameEdits(doc, { line: 1, character: 4 }, "renamed")).toBeNull();
  });

  it("returns no format edits when formatting disabled", async () => {
    setMockConfig("haproxy", "format.enabled", false);
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const format = capturedProviders.format as {
      provideDocumentFormattingEdits: (doc: unknown) => Promise<unknown[]>;
    };
    expect(await format.provideDocumentFormattingEdits(haproxyDocument("global"))).toEqual([]);
  });

  it("returns no format edits when bundle load fails", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("missing schema"));
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const format = capturedProviders.format as {
      provideDocumentFormattingEdits: (doc: unknown) => Promise<unknown[]>;
    };
    expect(
      await format.provideDocumentFormattingEdits(
        haproxyDocument("    fcgi-app myapp\n        mode http"),
      ),
    ).toEqual([]);
  });

  it("cleans up on document close", async () => {
    const doc = haproxyDocument("defaults\n    mode http");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 50);

    const closeListeners: Array<(d: typeof doc) => void> = [];
    vi.spyOn(workspace, "onDidCloseTextDocument").mockImplementation((listener) => {
      closeListeners.push(listener);
      return { dispose: () => {} };
    });

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    closeListeners[0](doc);
    expect(collection?.delete).toHaveBeenCalledWith(doc.uri);
  });

  it("skips non-haproxy documents", async () => {
    const doc = { ...haproxyDocument("plain"), languageId: "plaintext" };
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "diagnostics.debounceMs", 50);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const collection = getLastDiagnosticCollection();
    expect(collection?.set).not.toHaveBeenCalled();
  });
});
