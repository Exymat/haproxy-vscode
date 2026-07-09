import {
  logWorkspaceIndexCompleted,
  logWorkspaceIndexStarted,
  resetHaproxyOutputChannelState,
  setHaproxyLogSink,
} from "../../../src/outputChannel";
import { scheduleWorkspaceSymbolIndexRebuild } from "../../../src/symbolIndex";
import { setMockWorkspaceFile } from "../../__mocks__/vscode";
import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  schema,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("workspace symbol index output logging", () => {
  setupWorkspaceSymbolIndexTests();

  const lines: string[] = [];

  beforeEach(() => {
    resetHaproxyOutputChannelState();
    lines.length = 0;
    setHaproxyLogSink({
      appendLine(value: string) {
        lines.push(value);
      },
    });
  });

  afterEach(() => {
    setHaproxyLogSink(undefined);
  });

  it("logs full workspace rebuild stats including skipped files and caps", async () => {
    setMockWorkspaceFile("file:///nginx.cfg", "server { listen 80; }");
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");

    await buildWorkspace(1, Number.POSITIVE_INFINITY);

    expect(lines.some((line) => line.includes("Workspace index rebuild started (full)"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("discovered=3, indexed=1"))).toBe(true);
    expect(lines.some((line) => line.includes("skip reasons: not-haproxy-config=1"))).toBe(true);
    expect(lines.some((line) => line.includes("CAPPED (maxFiles)"))).toBe(true);
  });

  it("does not log incremental rebuild lifecycle events", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    await buildWorkspace();

    lines.length = 0;
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
      scope: "incremental",
      discoveredFiles: 1,
      indexedFiles: 1,
      skippedFiles: 0,
      skipReasons: {},
      capped: false,
      totalLines: 1,
      totalBytes: 10,
      durationMs: 1,
    });

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: { uri: { toString: () => "file:///a.cfg" } } as never,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(lines).toHaveLength(0);
  });
});
