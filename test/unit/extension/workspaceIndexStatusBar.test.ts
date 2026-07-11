import { hasCappedWorkspaceFolders } from "../../../src/symbolIndex";
import {
  commands,
  getRegisteredCommand,
  setMockActiveTextEditor,
  setMockWorkspaceFile,
  StatusBarItem,
  triggerMockActiveEditorChange,
  window,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";
import {
  OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND,
  registerWorkspaceIndexStatusBar,
} from "../../../src/extension/workspaceIndexStatusBar";
import { buildWorkspace, setupWorkspaceSymbolIndexTests } from "../workspaceSymbolIndex/helpers";

function haproxyDocument(content: string, uri = "file:///a.cfg") {
  const lines = content.split(/\r?\n/);
  return {
    uri: { fsPath: uri, toString: () => uri },
    languageId: "haproxy",
    version: 1,
    lineCount: lines.length,
    lineAt(lineNo: number) {
      return { text: lines[lineNo] ?? "" };
    },
    getText() {
      return content;
    },
  };
}

describe("workspaceIndexStatusBar", () => {
  setupWorkspaceSymbolIndexTests();

  it("registers capped index status bar item", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerWorkspaceIndexStatusBar(mockExtensionContext() as never);

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("$(warning) HAProxy index capped");
    expect(items[0]?.command).toBe(OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND);
    expect(getRegisteredCommand(OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND)).toBeDefined();
  });

  it("shows status bar for capped versioned haproxy editors", async () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    const refresh = registerWorkspaceIndexStatusBar(mockExtensionContext() as never);
    const item = items[0];

    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");
    await buildWorkspace(1000, 2);
    expect(hasCappedWorkspaceFolders()).toBe(true);

    setMockActiveTextEditor({
      document: { ...haproxyDocument("backend a"), languageId: "haproxy-3.2" } as never,
    });
    refresh();
    expect(item.show).toHaveBeenCalled();
  });

  it("shows status bar for capped haproxy editors and hides otherwise", async () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    const refresh = registerWorkspaceIndexStatusBar(mockExtensionContext() as never);
    const item = items[0];

    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");
    await buildWorkspace(1000, 2);
    expect(hasCappedWorkspaceFolders()).toBe(true);

    setMockActiveTextEditor({ document: haproxyDocument("backend a") as never });
    refresh();
    expect(item.show).toHaveBeenCalled();

    item.show.mockClear();
    item.hide.mockClear();
    setMockActiveTextEditor({
      document: { ...haproxyDocument("backend a"), languageId: "plaintext" } as never,
    });
    refresh();
    expect(item.hide).toHaveBeenCalled();
  });

  it("refreshes when the active editor changes", async () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerWorkspaceIndexStatusBar(mockExtensionContext() as never);
    const item = items[0];

    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");
    await buildWorkspace(1000, 2);

    setMockActiveTextEditor({ document: haproxyDocument("backend a") as never });
    triggerMockActiveEditorChange();
    expect(item.show).toHaveBeenCalled();
  });

  it("command opens workspace symbol settings", async () => {
    registerWorkspaceIndexStatusBar(mockExtensionContext() as never);
    const handler = getRegisteredCommand(OPEN_WORKSPACE_SYMBOL_SETTINGS_COMMAND);
    await handler?.();

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "@id:haproxy.workspaceSymbols.maxFiles",
    );
  });
});
