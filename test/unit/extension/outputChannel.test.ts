import {
  logBundleLoadFailed,
  logBundleLoadStarted,
  logBundleLoadSucceeded,
  logConfiguredVersion,
  logDiskEntryReadFailure,
  logExtensionActivated,
  logSupportSnapshot,
  logWorkspaceIndexCompleted,
  logWorkspaceIndexDisabled,
  logWorkspaceIndexSchemaLoadFailed,
  logWorkspaceIndexStarted,
  registerHaproxyOutputChannel,
  resetHaproxyOutputChannelState,
  setHaproxyLogSink,
} from "../../../src/extension/outputChannel";
import {
  lastOutputChannel,
  resetMockVscode,
  setMockConfig,
  setMockWorkspaceFolders,
} from "../../helpers/vscode";
import { mockExtensionContext } from "../../helpers/extensionContext";

describe("outputChannel", () => {
  const lines: string[] = [];
  const sink = {
    appendLine(value: string) {
      lines.push(value);
    },
  };

  beforeEach(() => {
    resetMockVscode();
    resetHaproxyOutputChannelState();
    lines.length = 0;
    setHaproxyLogSink(sink);
  });

  afterEach(() => {
    setHaproxyLogSink(undefined);
  });

  it("registers the HAProxy output channel", () => {
    registerHaproxyOutputChannel(mockExtensionContext() as never);
    expect(lastOutputChannel).toBeDefined();
    expect(lastOutputChannel?.appendLine).toBeDefined();
  });

  it("logs extension activation metadata", () => {
    logExtensionActivated("0.17.1");
    expect(lines.some((line) => line.includes("Extension activated (v0.17.1)"))).toBe(true);
    expect(lines.some((line) => line.includes("Supported HAProxy versions"))).toBe(true);
  });

  it("logs bundle load lifecycle events", () => {
    logBundleLoadStarted("3.2");
    logBundleLoadSucceeded("3.2");
    logBundleLoadFailed("3.2", "missing file", "schema");

    expect(lines.some((line) => line.includes("Loading schema and language data"))).toBe(true);
    expect(lines.some((line) => line.includes("Loaded schema and language data"))).toBe(true);
    expect(lines.some((line) => line.includes("Failed to load schema bundle"))).toBe(true);
    expect(lines.some((line) => line.includes("(schema)"))).toBe(true);
    logBundleLoadFailed("3.2", "missing file");
    expect(lines.some((line) => line.includes("Failed to load schema bundle"))).toBe(true);
    expect(lines.filter((line) => line.includes("Failed to load schema bundle"))).toHaveLength(2);
  });

  it("logs configured version once per folder on document open", () => {
    setMockWorkspaceFolders([
      { uri: { fsPath: "/workspace", toString: () => "file:///workspace" } },
    ]);
    setMockConfig("haproxy", "version", "3.4");
    const uri = {
      fsPath: "/workspace/app.cfg",
      toString: () => "file:///workspace/app.cfg",
    } as never;

    logConfiguredVersion("3.4", "document-open", uri);
    logConfiguredVersion("3.4", "document-open", uri);

    expect(lines.filter((line) => line.includes("HAProxy version 3.4"))).toHaveLength(1);
  });

  it("logs configured version again after configuration change", () => {
    setMockWorkspaceFolders([
      { uri: { fsPath: "/workspace", toString: () => "file:///workspace" } },
    ]);
    const uri = {
      fsPath: "/workspace/app.cfg",
      toString: () => "file:///workspace/app.cfg",
    } as never;

    logConfiguredVersion("3.2", "document-open", uri);
    logConfiguredVersion("3.4", "config-change", uri);

    expect(lines.filter((line) => line.includes("HAProxy version"))).toHaveLength(2);
    expect(lines.some((line) => line.includes("configuration changed"))).toBe(true);
  });

  it("logs workspace index lifecycle without incremental noise", () => {
    logWorkspaceIndexStarted("folder", "workspace", "full", {
      maxFiles: 100,
      maxTotalLines: 1000,
      maxFileBytes: 10000,
      maxTotalBytes: 20000,
      maxLineBytes: 500,
    });
    logWorkspaceIndexStarted("folder", "workspace", "incremental", {
      maxFiles: 100,
      maxTotalLines: 1000,
      maxFileBytes: 10000,
      maxTotalBytes: 20000,
      maxLineBytes: 500,
    });
    logWorkspaceIndexCompleted({
      folderKey: "folder",
      folderLabel: "workspace",
      scope: "full",
      discoveredFiles: 5,
      indexedFiles: 3,
      skippedFiles: 2,
      skipReasons: { "not-haproxy-config": 2 },
      capped: false,
      totalLines: 42,
      totalBytes: 900,
      durationMs: 12,
    });
    logWorkspaceIndexDisabled();

    expect(lines.filter((line) => line.includes("Workspace index rebuild started"))).toHaveLength(
      1,
    );
    expect(lines.some((line) => line.includes("discovered=5, indexed=3"))).toBe(true);
    expect(lines.some((line) => line.includes("skip reasons: not-haproxy-config=2"))).toBe(true);
    expect(lines.some((line) => line.includes("Workspace symbol index disabled"))).toBe(true);
  });

  it("logs capped workspace rebuilds without a cap reason", () => {
    logWorkspaceIndexCompleted({
      folderKey: "folder",
      folderLabel: "workspace",
      scope: "full",
      discoveredFiles: 2,
      indexedFiles: 1,
      skippedFiles: 1,
      skipReasons: {},
      capped: true,
      totalLines: 10,
      totalBytes: 100,
      durationMs: 5,
    });

    expect(lines.some((line) => line.includes("; CAPPED"))).toBe(true);
  });

  it("ignores undefined skip reason counts in workspace rebuild summaries", () => {
    logWorkspaceIndexCompleted({
      folderKey: "folder",
      folderLabel: "workspace",
      scope: "full",
      discoveredFiles: 2,
      indexedFiles: 1,
      skippedFiles: 1,
      skipReasons: { "read-failed": undefined },
      capped: false,
      totalLines: 10,
      totalBytes: 100,
      durationMs: 5,
    });

    expect(lines.some((line) => line.includes("skip reasons: none"))).toBe(true);
  });

  it("does not log schema load failures for incremental rebuild scopes", () => {
    logWorkspaceIndexSchemaLoadFailed("workspace", "incremental", new Error("schema unavailable"));
    logWorkspaceIndexSchemaLoadFailed("workspace", "none", new Error("schema unavailable"));

    expect(lines).toHaveLength(0);
  });

  it("logs non-Error schema load failures for full rebuild scopes", () => {
    logWorkspaceIndexSchemaLoadFailed("workspace", "full", "schema unavailable");

    expect(lines.some((line) => line.includes("schema unavailable"))).toBe(true);
  });

  it("uses folder path labels when workspace folder names are missing", () => {
    setMockWorkspaceFolders([
      { uri: { fsPath: "/workspace", toString: () => "file:///workspace" } },
    ]);
    const uri = {
      fsPath: "/workspace/app.cfg",
      toString: () => "file:///workspace/app.cfg",
    } as never;

    logConfiguredVersion("3.2", "document-open", uri);

    expect(lines.some((line) => line.includes("HAProxy version 3.2 for /workspace"))).toBe(true);
  });

  it("uses folder keys when workspace folder names and filesystem paths are missing", () => {
    setMockWorkspaceFolders([{ uri: { toString: () => "file:///workspace" } }]);
    const uri = {
      toString: () => "file:///workspace/app.cfg",
    } as never;

    logConfiguredVersion("3.2", "document-open", uri);

    expect(lines.some((line) => line.includes("HAProxy version 3.2 for file:///workspace"))).toBe(
      true,
    );
  });

  it("logs support snapshot for global configuration without workspace folders", () => {
    setMockWorkspaceFolders(undefined);
    setMockConfig("haproxy", "version", "2.8");

    logSupportSnapshot({
      extensionVersion: "0.17.1",
      bundleVersion: "2.8",
      workspaceSymbolSettings: {
        enabled: false,
        include: [],
        exclude: [],
        maxFiles: 0,
        maxTotalLines: 0,
        maxFileBytes: 0,
        maxTotalBytes: 0,
        maxLineBytes: 0,
        debounceMs: 0,
      },
    });

    expect(lines.some((line) => line.includes("configured HAProxy version (global): 2.8"))).toBe(
      true,
    );
  });

  it("logs unreadable disk entries", () => {
    logDiskEntryReadFailure(
      { fsPath: "/missing.cfg", toString: () => "file:///missing.cfg" } as never,
      "ENOENT",
    );
    expect(lines.some((line) => line.includes("Skipped unreadable file (ENOENT)"))).toBe(true);
  });

  it("logs configured version for global workspace context", () => {
    setMockWorkspaceFolders(undefined);
    setMockConfig("haproxy", "version", "2.8");

    logConfiguredVersion("2.8", "config-change");

    expect(lines.some((line) => line.includes("HAProxy version 2.8 for global"))).toBe(true);
  });

  it("logs support snapshot metadata", () => {
    setMockWorkspaceFolders([
      { uri: { fsPath: "/workspace", toString: () => "file:///workspace" }, name: "repo" },
    ]);
    setMockConfig("haproxy", "version", "3.2");

    logSupportSnapshot({
      extensionVersion: "0.17.1",
      bundleVersion: "3.2",
      workspaceSymbolSettings: {
        enabled: true,
        include: ["**/*.cfg"],
        exclude: ["**/vendor/**"],
        maxFiles: 100,
        maxTotalLines: 1000,
        maxFileBytes: 10000,
        maxTotalBytes: 20000,
        maxLineBytes: 500,
        debounceMs: 100,
      },
    });

    expect(lines.some((line) => line.includes("support snapshot"))).toBe(true);
    expect(lines.some((line) => line.includes("extension: v0.17.1"))).toBe(true);
    expect(lines.some((line) => line.includes("active schema bundle: HAProxy 3.2"))).toBe(true);
    expect(lines.some((line) => line.includes("configured HAProxy version (repo): 3.2"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("workspace symbols: enabled"))).toBe(true);
  });
});
