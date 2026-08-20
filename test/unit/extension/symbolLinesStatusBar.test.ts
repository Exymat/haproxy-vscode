import {
  commands,
  getRegisteredCommand,
  resetMockVscode,
  setMockActiveTextEditor,
  setMockConfig,
  StatusBarItem,
  triggerMockActiveEditorChange,
  triggerMockConfigurationChange,
  triggerMockOpenTextDocument,
  triggerMockTextDocumentChange,
  window,
  workspace,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import {
  isDocumentSymbolLinesCapped,
  OPEN_SYMBOL_LINES_SETTINGS_COMMAND,
  registerSymbolLinesStatusBar,
} from "../../../src/extension/symbolLinesStatusBar";

function haproxyDocument(content: string, lineCount?: number) {
  const lines = content.split(/\r?\n/);
  return {
    uri: { toString: () => "file:///large.cfg" },
    languageId: "haproxy",
    version: 1,
    lineCount: lineCount ?? lines.length,
    lineAt(lineNo: number) {
      return { text: lines[lineNo] ?? "" };
    },
    getText() {
      return content;
    },
  };
}

describe("symbolLinesStatusBar", () => {
  beforeEach(() => {
    resetMockVscode();
    setMockConfig("haproxy", "symbols.maxLines", 100);
  });

  it("registers symbol line cap status bar item", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerSymbolLinesStatusBar(
      mockExtensionContext() as never,
      () =>
        ({
          maxSymbolLines: 100,
        }) as never,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("$(warning) HAProxy symbols capped");
    expect(items[0]?.command).toBe(OPEN_SYMBOL_LINES_SETTINGS_COMMAND);
    expect(getRegisteredCommand(OPEN_SYMBOL_LINES_SETTINGS_COMMAND)).toBeDefined();
  });

  it("shows status bar when active document exceeds symbol line limit", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    const refresh = registerSymbolLinesStatusBar(
      mockExtensionContext() as never,
      () =>
        ({
          maxSymbolLines: 100,
        }) as never,
    );
    const item = items[0];

    setMockActiveTextEditor({
      document: haproxyDocument("backend api", 150) as never,
    });
    refresh();
    expect(item.show).toHaveBeenCalled();
  });

  it("hides status bar for files within the symbol line limit", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerSymbolLinesStatusBar(
      mockExtensionContext() as never,
      () =>
        ({
          maxSymbolLines: 100,
        }) as never,
    );
    const item = items[0];

    setMockActiveTextEditor({ document: haproxyDocument("backend api", 50) as never });
    triggerMockActiveEditorChange();
    expect(item.hide).toHaveBeenCalled();
  });

  it("refreshes on open and text-document change events", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    let textChangeListener: ((event: { document: unknown }) => void) | undefined;
    vi.spyOn(workspace, "onDidChangeTextDocument").mockImplementation((listener) => {
      textChangeListener = listener as (event: { document: unknown }) => void;
      return { dispose: () => {} };
    });

    registerSymbolLinesStatusBar(
      mockExtensionContext() as never,
      () =>
        ({
          maxSymbolLines: 100,
        }) as never,
    );
    const item = items[0];
    item.show.mockClear();
    item.hide.mockClear();

    setMockActiveTextEditor({
      document: haproxyDocument("backend api", 150) as never,
    });
    triggerMockOpenTextDocument(haproxyDocument("backend api", 150) as never);
    expect(item.show).toHaveBeenCalled();

    item.show.mockClear();
    expect(textChangeListener).toBeDefined();
    textChangeListener?.({ document: haproxyDocument("backend api", 150) });
    expect(item.show).toHaveBeenCalled();
    triggerMockTextDocumentChange(haproxyDocument("backend api", 150) as never);
  });

  it("detects capped documents by line count", () => {
    expect(isDocumentSymbolLinesCapped(haproxyDocument("backend api", 150) as never, 100)).toBe(
      true,
    );
    expect(isDocumentSymbolLinesCapped(haproxyDocument("backend api", 50) as never, 100)).toBe(
      false,
    );
  });

  it("command opens symbol line settings", async () => {
    registerSymbolLinesStatusBar(
      mockExtensionContext() as never,
      () =>
        ({
          maxSymbolLines: 100,
        }) as never,
    );
    const handler = getRegisteredCommand(OPEN_SYMBOL_LINES_SETTINGS_COMMAND);
    await handler?.();

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "@id:haproxy.symbols.maxLines",
    );
  });

  it("refreshes when symbol max lines setting changes", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerSymbolLinesStatusBar(
      mockExtensionContext() as never,
      () =>
        ({
          maxSymbolLines: 100,
        }) as never,
    );
    const item = items[0];

    setMockActiveTextEditor({
      document: haproxyDocument("backend api", 150) as never,
    });
    triggerMockConfigurationChange("haproxy.symbols.maxLines");
    expect(item.show).toHaveBeenCalled();
  });
});
