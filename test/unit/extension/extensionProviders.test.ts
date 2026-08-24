import { activate, deactivate } from "../../../src/extension";
import * as schema from "../../../src/schema/load";
import * as symbolIndex from "../../../src/symbolIndex";
import {
  commands,
  Diagnostic,
  DiagnosticSeverity,
  getRegisteredCommand,
  getLastDiagnosticCollection,
  languages,
  mockTextDocuments,
  Range,
  resetMockVscode,
  setMockConfig,
  setMockWorkspaceFile,
  workspace,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import { loadSchema } from "../../helpers/schema";
import { defaultWorkspaceSymbolSettings } from "../workspaceSymbolIndex/helpers";

const schemaFixture = loadSchema("3.4");

function haproxyDocument(content: string) {
  const lines = content.split(/\r?\n/);
  return {
    uri: { toString: () => "file:///test.cfg" },
    languageId: "haproxy",
    version: 1,
    lineCount: lines.length,
    lineAt(lineNo: number) {
      const text = lines[lineNo] ?? "";
      return {
        text,
        range: {
          start: { line: lineNo, character: 0 },
          end: { line: lineNo, character: text.length },
        },
        rangeIncludingLineBreak: {
          start: { line: lineNo, character: 0 },
          end: { line: lineNo, character: text.length + 1 },
        },
      };
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
    resetMockVscode();
    commands.executeCommand.mockClear();
    deactivate();
    capturedProviders = {};

    vi.spyOn(languages, "registerCompletionItemProvider").mockImplementation((_s, provider) => {
      capturedProviders.completion = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerCodeActionsProvider").mockImplementation((_s, provider) => {
      capturedProviders.codeActions = provider;
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
    vi.spyOn(languages, "registerDocumentRangeFormattingEditProvider").mockImplementation(
      (_s, provider) => {
        capturedProviders.rangeFormat = provider;
        return { provider, dispose: () => {} };
      },
    );
    vi.spyOn(languages, "registerSignatureHelpProvider").mockImplementation((_s, provider) => {
      capturedProviders.signatureHelp = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerDocumentHighlightProvider").mockImplementation((_s, provider) => {
      capturedProviders.highlights = provider;
      return { provider, dispose: () => {} };
    });
    vi.spyOn(languages, "registerDocumentSemanticTokensProvider").mockImplementation(
      (_s, provider) => {
        capturedProviders.semanticTokens = provider;
        return { provider, dispose: () => {} };
      },
    );
    vi.spyOn(languages, "registerWorkspaceSymbolProvider").mockImplementation((provider) => {
      capturedProviders.workspaceSymbols = provider;
      return { provider, dispose: () => {} };
    });
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
      provideDocumentSymbols: (doc: unknown) => Promise<unknown>;
    };
    const folding = capturedProviders.folding as {
      provideFoldingRanges: (doc: unknown) => Promise<unknown>;
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
    expect(await symbols.provideDocumentSymbols(doc)).toBeDefined();
    expect(await folding.provideFoldingRanges(doc)).toBeDefined();
  });

  it("runs the internal peek definition command", async () => {
    const doc = haproxyDocument("backend api\nfrontend web\n    use_backend api");
    mockTextDocuments.push(doc);
    setMockConfig("haproxy", "workspaceSymbols.enabled", false);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const command = getRegisteredCommand("haproxy.peekDefinitionAtPosition");
    expect(command).toBeDefined();
    await command?.("file:///test.cfg", 2, "    use_backend ".length);
    expect(commands.executeCommand).toHaveBeenCalledWith("editor.action.peekDefinition");
  });

  it("registers a quick fix for inline diagnostic suppression", async () => {
    const doc = haproxyDocument("frontend web\n    http-request module-action if TRUE");
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const codeActions = capturedProviders.codeActions as {
      provideCodeActions: (
        doc: unknown,
        range: unknown,
        context: { diagnostics: Diagnostic[] },
      ) => unknown[];
    };
    const diagnostic = new Diagnostic(
      new Range(1, 4, 1, 16),
      "Unknown http-request action 'module-action'",
      DiagnosticSeverity.Warning,
    );
    diagnostic.source = "haproxy";
    diagnostic.code = "unknown-action";

    const actions = codeActions.provideCodeActions(doc, undefined, { diagnostics: [diagnostic] });
    expect(actions).toHaveLength(1);
  });

  it("rejects malformed peek definition positions", async () => {
    const doc = haproxyDocument("backend api\nfrontend web\n    use_backend api");
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const command = getRegisteredCommand("haproxy.peekDefinitionAtPosition");
    expect(command).toBeDefined();
    await command?.("file:///test.cfg", -1, 0);
    await command?.("file:///test.cfg", 0, -1);
    await command?.("file:///test.cfg", 1.5, 0);
    await command?.("file:///test.cfg", 0, Number.NaN);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects non-file peek definition URIs", async () => {
    const doc = haproxyDocument("backend api\nfrontend web\n    use_backend api");
    mockTextDocuments.push(doc);

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const command = getRegisteredCommand("haproxy.peekDefinitionAtPosition");
    expect(command).toBeDefined();
    await command?.("https://example.com/test.cfg", 0, 0);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("rejects peek definition URIs outside the workspace index", async () => {
    const doc = haproxyDocument("backend api\nfrontend web\n    use_backend api");
    mockTextDocuments.push(doc);
    setMockWorkspaceFile("file:///indexed.cfg", "backend indexed");

    activate(mockExtensionContext() as never);
    symbolIndex.scheduleWorkspaceSymbolIndexRebuild(
      schemaFixture,
      defaultWorkspaceSymbolSettings({ debounceMs: 0 }),
      4000,
      { scope: "full" },
    );
    await vi.runAllTimersAsync();
    await vi.waitFor(
      () => {
        expect(symbolIndex.getWorkspaceSymbolIndex()?.documents.has("file:///indexed.cfg")).toBe(
          true,
        );
      },
      { timeout: 5000 },
    );

    const command = getRegisteredCommand("haproxy.peekDefinitionAtPosition");
    expect(command).toBeDefined();
    await command?.("file:///test.cfg", 2, "    use_backend ".length);
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("runs peek definition for URIs indexed in the workspace graph", async () => {
    const doc = haproxyDocument("backend api\nfrontend web\n    use_backend api");
    mockTextDocuments.push(doc);
    setMockWorkspaceFile("file:///test.cfg", doc.getText());

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

    const completionPromise = completion.provideCompletionItems(doc, { line: 1, character: 4 });
    const hoverPromise = hover.provideHover(doc, { line: 1, character: 4 });
    const definitionPromise = definition.provideDefinition(doc, { line: 1, character: 4 });
    const referencesPromise = references.provideReferences(
      doc,
      { line: 1, character: 4 },
      { includeDeclaration: true },
    );
    const prepareRenamePromise = rename.prepareRename(doc, { line: 1, character: 4 });
    const renameEditsPromise = rename.provideRenameEdits(doc, { line: 1, character: 4 }, "renamed");
    await vi.runAllTimersAsync();

    expect(await completionPromise).toEqual([]);
    expect(await hoverPromise).toBeNull();
    expect(await definitionPromise).toBeNull();
    expect(await referencesPromise).toEqual([]);
    expect(await prepareRenamePromise).toBeNull();
    expect(await renameEditsPromise).toBeNull();
  });

  it("returns no format edits when formatting disabled", async () => {
    setMockConfig("haproxy", "format.enabled", false);
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const format = capturedProviders.format as {
      provideDocumentFormattingEdits: (doc: unknown) => Promise<unknown[]>;
    };
    const rangeFormat = capturedProviders.rangeFormat as {
      provideDocumentRangeFormattingEdits: (
        doc: unknown,
        range: {
          start: { line: number; character?: number };
          end: { line: number; character?: number };
        },
      ) => Promise<unknown[]>;
    };
    const doc = haproxyDocument("global");
    expect(await format.provideDocumentFormattingEdits(doc)).toEqual([]);
    expect(
      await rangeFormat.provideDocumentRangeFormattingEdits(doc, {
        start: { line: 0 },
        end: { line: 0 },
      }),
    ).toEqual([]);
  });

  it("returns no format edits when bundle load fails", async () => {
    vi.spyOn(schema, "loadSchemaAsync").mockRejectedValue(new Error("missing schema"));
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const format = capturedProviders.format as {
      provideDocumentFormattingEdits: (doc: unknown) => Promise<unknown[]>;
    };
    const rangeFormat = capturedProviders.rangeFormat as {
      provideDocumentRangeFormattingEdits: (
        doc: unknown,
        range: {
          start: { line: number; character?: number };
          end: { line: number; character?: number };
        },
      ) => Promise<unknown[]>;
    };
    const signatureHelp = capturedProviders.signatureHelp as {
      provideSignatureHelp: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const symbols = capturedProviders.symbols as {
      provideDocumentSymbols: (doc: unknown) => Promise<unknown>;
    };
    const folding = capturedProviders.folding as {
      provideFoldingRanges: (doc: unknown) => Promise<unknown>;
    };
    const highlights = capturedProviders.highlights as {
      provideDocumentHighlights: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const semanticTokens = capturedProviders.semanticTokens as {
      provideDocumentSemanticTokens: (doc: unknown) => Promise<{ data: Uint32Array }>;
    };
    const workspaceSymbols = capturedProviders.workspaceSymbols as {
      provideWorkspaceSymbols: (query: string) => Promise<unknown>;
    };
    const doc = haproxyDocument("    fcgi-app myapp\n        mode http");
    const formatPromise = format.provideDocumentFormattingEdits(doc);
    const rangePromise = rangeFormat.provideDocumentRangeFormattingEdits(doc, {
      start: { line: 0 },
      end: { line: 1 },
    });
    const signaturePromise = signatureHelp.provideSignatureHelp(doc, { line: 1, character: 8 });
    const symbolsPromise = symbols.provideDocumentSymbols(doc);
    const foldingPromise = folding.provideFoldingRanges(doc);
    const highlightsPromise = highlights.provideDocumentHighlights(doc, { line: 0, character: 4 });
    const semanticPromise = semanticTokens.provideDocumentSemanticTokens(doc);
    const workspacePromise = workspaceSymbols.provideWorkspaceSymbols("api");
    await vi.runAllTimersAsync();
    expect(await formatPromise).toEqual([]);
    expect(await rangePromise).toEqual([]);
    expect(await signaturePromise).toBeNull();
    expect(await symbolsPromise).toEqual([]);
    expect(await foldingPromise).toEqual([]);
    expect(await highlightsPromise).toEqual([]);
    expect((await semanticPromise).data.length).toBe(0);
    expect(await workspacePromise).toEqual([]);
  });

  it("invokes range format, signature help, highlights, semantic tokens, and workspace symbols", async () => {
    const doc = haproxyDocument(
      "frontend web\n    bind :80\n    use_backend api\nbackend api\n    server s1 127.0.0.1:80",
    );
    mockTextDocuments.push(doc);
    setMockWorkspaceFile("file:///test.cfg", doc.getText());

    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const rangeFormat = capturedProviders.rangeFormat as {
      provideDocumentRangeFormattingEdits: (
        doc: unknown,
        range: {
          start: { line: number; character?: number };
          end: { line: number; character?: number };
        },
      ) => Promise<unknown[]>;
    };
    const signatureHelp = capturedProviders.signatureHelp as {
      provideSignatureHelp: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown>;
    };
    const highlights = capturedProviders.highlights as {
      provideDocumentHighlights: (
        doc: unknown,
        pos: { line: number; character: number },
      ) => Promise<unknown[]>;
    };
    const semanticTokens = capturedProviders.semanticTokens as {
      provideDocumentSemanticTokens: (doc: unknown) => Promise<{ data: Uint32Array }>;
    };
    const workspaceSymbols = capturedProviders.workspaceSymbols as {
      provideWorkspaceSymbols: (query: string) => Promise<unknown[]>;
    };

    const rangeEdits = await rangeFormat.provideDocumentRangeFormattingEdits(doc, {
      start: { line: 1 },
      end: { line: 2 },
    });
    expect(rangeEdits.length).toBe(1);

    const lineBoundaryEdits = (await rangeFormat.provideDocumentRangeFormattingEdits(doc, {
      start: { line: 1, character: 0 },
      end: { line: 2, character: 0 },
    })) as Array<{
      range: { end: { line: number; character: number } };
      newText: string;
    }>;
    expect(lineBoundaryEdits[0]?.range.end).toEqual({ line: 1, character: "    bind :80".length });
    expect(lineBoundaryEdits[0]?.newText).not.toContain("use_backend");

    const lastLineEdits = await rangeFormat.provideDocumentRangeFormattingEdits(doc, {
      start: { line: 4 },
      end: { line: 4 },
    });
    expect(lastLineEdits.length).toBe(1);

    await signatureHelp.provideSignatureHelp(doc, { line: 1, character: 8 });
    expect(
      await highlights.provideDocumentHighlights(doc, {
        line: 2,
        character: "    use_backend ".length,
      }),
    ).toBeDefined();
    expect((await semanticTokens.provideDocumentSemanticTokens(doc)).data.length).toBeGreaterThan(
      0,
    );
    expect(await workspaceSymbols.provideWorkspaceSymbols("api")).toBeDefined();
  });

  it("returns empty workspace symbols when workspace indexing is disabled", async () => {
    setMockConfig("haproxy", "workspaceSymbols.enabled", false);
    activate(mockExtensionContext() as never);
    await vi.runAllTimersAsync();

    const workspaceSymbols = capturedProviders.workspaceSymbols as {
      provideWorkspaceSymbols: (query: string) => Promise<unknown>;
    };
    const symbolsPromise = workspaceSymbols.provideWorkspaceSymbols("api");
    await vi.runAllTimersAsync();
    expect(await symbolsPromise).toEqual([]);
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
