import { registerVersionStatusBar } from "../../../src/statusBar";
import { getConfiguredVersion } from "../../../src/version";
import {
  getRegisteredCommand,
  resetMockVscode,
  setMockActiveTextEditor,
  setMockConfig,
  setMockQuickPickResult,
  StatusBarItem,
  triggerMockActiveEditorChange,
  triggerMockConfigurationChange,
  window,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";

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
    getText() {
      return content;
    },
  };
}

describe("statusBar", () => {
  beforeEach(() => {
    resetMockVscode();
    setMockConfig("haproxy", "version", "3.2");
  });

  it("registers version status bar item", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerVersionStatusBar(mockExtensionContext() as never);

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("$(versions) HAProxy 3.2");
    expect(items[0]?.command).toBe("haproxy.selectVersion");
    expect(getRegisteredCommand("haproxy.selectVersion")).toBeDefined();
  });

  it("shows status bar for haproxy editors and hides otherwise", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerVersionStatusBar(mockExtensionContext() as never);
    const item = items[0];

    setMockActiveTextEditor({ document: haproxyDocument("global") as never });
    triggerMockActiveEditorChange();
    expect(item.show).toHaveBeenCalled();

    item.show.mockClear();
    item.hide.mockClear();
    setMockActiveTextEditor({
      document: { ...haproxyDocument("global"), languageId: "plaintext" } as never,
    });
    triggerMockActiveEditorChange();
    expect(item.hide).toHaveBeenCalled();
  });

  it("refreshes label when version configuration changes", () => {
    const items: StatusBarItem[] = [];
    vi.spyOn(window, "createStatusBarItem").mockImplementation(() => {
      const item = new StatusBarItem();
      items.push(item);
      return item;
    });

    registerVersionStatusBar(mockExtensionContext() as never);
    setMockConfig("haproxy", "version", "3.4");
    triggerMockConfigurationChange("haproxy.version");

    expect(items[0]?.text).toBe("$(versions) HAProxy 3.4");
  });

  it("command sets version from quick pick", async () => {
    registerVersionStatusBar(mockExtensionContext() as never);
    setMockQuickPickResult({ label: "2.8" });

    const handler = getRegisteredCommand("haproxy.selectVersion");
    await handler?.();

    expect(getConfiguredVersion()).toBe("2.8");
  });

  it("command ignores pick when version unchanged", async () => {
    registerVersionStatusBar(mockExtensionContext() as never);
    setMockQuickPickResult({ label: "3.2" });

    const handler = getRegisteredCommand("haproxy.selectVersion");
    await handler?.();

    expect(getConfiguredVersion()).toBe("3.2");
  });
});
