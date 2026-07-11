import {
  DEFAULT_HAPROXY_VERSION,
  getConfiguredVersion,
  getConfiguredVersionForUri,
  onVersionConfigurationChanged,
  setConfiguredVersion,
  SUPPORTED_HAPROXY_VERSIONS,
} from "../../../src/extension/version";
import {
  ConfigurationTarget,
  resetMockVscode,
  setMockConfig,
  setMockConfigForUri,
  setMockWorkspaceFolders,
  triggerMockConfigurationChange,
  triggerMockFolderConfigurationChange,
  workspace,
} from "../../helpers/vscode";

describe("version", () => {
  beforeEach(() => {
    resetMockVscode();
    vi.restoreAllMocks();
  });

  it("returns configured version when valid", () => {
    for (const version of SUPPORTED_HAPROXY_VERSIONS) {
      setMockConfig("haproxy", "version", version);
      expect(getConfiguredVersion()).toBe(version);
    }
  });

  it("returns default when version is missing or invalid", () => {
    expect(getConfiguredVersion()).toBe(DEFAULT_HAPROXY_VERSION);
    setMockConfig("haproxy", "version", "9.9");
    expect(getConfiguredVersion()).toBe(DEFAULT_HAPROXY_VERSION);
    setMockConfig("haproxy", "version", "");
    expect(getConfiguredVersion()).toBe(DEFAULT_HAPROXY_VERSION);
  });

  it("reads version scoped to a workspace resource", () => {
    const uri = { toString: () => "file:///workspace-a/app.cfg" };
    setMockConfig("haproxy", "version", "3.2");
    setMockConfigForUri(uri, "haproxy", "version", "2.6");
    expect(getConfiguredVersionForUri(uri as never)).toBe("2.6");
    expect(getConfiguredVersion()).toBe("3.2");
  });

  it("updates version at workspace-folder target when resource is in a folder", async () => {
    const uri = { toString: () => "file:///workspace/app.cfg" };
    setMockWorkspaceFolders([{ uri: { toString: () => "file:///workspace" } }]);
    const baseConfig = workspace.getConfiguration("haproxy", uri);
    let capturedTarget: number | undefined;
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: baseConfig.get.bind(baseConfig),
      update: (key: string, value: unknown, target?: number) => {
        capturedTarget = target;
        baseConfig.update(key, value, target);
      },
    });

    await setConfiguredVersion("3.4", uri as never);
    expect(capturedTarget).toBe(ConfigurationTarget.WorkspaceFolder);
    expect(getConfiguredVersionForUri(uri as never)).toBe("3.4");
  });

  it("updates version at workspace target when folders exist but no resource is given", async () => {
    setMockWorkspaceFolders([{ uri: { fsPath: "/workspace" } }]);
    const baseConfig = workspace.getConfiguration("haproxy");
    let capturedTarget: number | undefined;
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: baseConfig.get.bind(baseConfig),
      update: (key: string, value: unknown, target?: number) => {
        capturedTarget = target;
        baseConfig.update(key, value, target);
      },
    });

    await setConfiguredVersion("3.4");
    expect(capturedTarget).toBe(ConfigurationTarget.Workspace);
    expect(getConfiguredVersion()).toBe("3.4");
  });

  it("updates version at global target without workspace folders", async () => {
    setMockWorkspaceFolders(undefined);
    const baseConfig = workspace.getConfiguration("haproxy");
    let capturedTarget: number | undefined;
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: baseConfig.get.bind(baseConfig),
      update: (key: string, value: unknown, target?: number) => {
        capturedTarget = target;
        baseConfig.update(key, value, target);
      },
    });

    await setConfiguredVersion("2.8");
    expect(capturedTarget).toBe(ConfigurationTarget.Global);
  });

  it("notifies onVersionConfigurationChanged with affected versions and folders", () => {
    const listener = vi.fn();
    onVersionConfigurationChanged(listener);
    setMockConfig("haproxy", "version", "3.0");
    triggerMockConfigurationChange("haproxy.version");
    expect(listener).toHaveBeenCalledWith({
      versions: ["3.0"],
      affectedFolderUris: [undefined],
    });
  });

  it("ignores unrelated configuration changes", () => {
    const listener = vi.fn();
    onVersionConfigurationChanged(listener);
    triggerMockConfigurationChange("editor.tabSize");
    expect(listener).not.toHaveBeenCalled();
  });

  it("collects affected workspace folders for folder-scoped version changes", () => {
    setMockWorkspaceFolders([
      { uri: { toString: () => "file:///folder-a", fsPath: "/folder-a" }, name: "a" },
      { uri: { toString: () => "file:///folder-b", fsPath: "/folder-b" }, name: "b" },
    ]);
    setMockConfigForUri({ toString: () => "file:///folder-a" }, "haproxy", "version", "2.6");
    setMockConfigForUri({ toString: () => "file:///folder-b" }, "haproxy", "version", "3.4");

    const listener = vi.fn();
    onVersionConfigurationChanged(listener);
    triggerMockFolderConfigurationChange("haproxy.version", {
      folderUris: ["file:///folder-a"],
    });

    expect(listener).toHaveBeenCalledWith({
      versions: ["2.6"],
      affectedFolderUris: ["file:///folder-a"],
    });
  });

  it("deduplicates repeated workspace folders in version change events", () => {
    setMockWorkspaceFolders([
      { uri: { toString: () => "file:///folder-a", fsPath: "/folder-a" }, name: "a" },
      { uri: { toString: () => "file:///folder-a", fsPath: "/folder-a" }, name: "a-copy" },
    ]);
    setMockConfigForUri({ toString: () => "file:///folder-a" }, "haproxy", "version", "2.6");

    const listener = vi.fn();
    onVersionConfigurationChanged(listener);
    triggerMockFolderConfigurationChange("haproxy.version", {
      folderUris: ["file:///folder-a"],
    });

    expect(listener).toHaveBeenCalledWith({
      versions: ["2.6"],
      affectedFolderUris: ["file:///folder-a"],
    });
  });
});
