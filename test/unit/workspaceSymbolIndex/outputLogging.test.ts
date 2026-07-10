import {
  logWorkspaceIndexCompleted,
  logWorkspaceIndexStarted,
  resetHaproxyOutputChannelState,
  setHaproxyLogSink,
} from "../../../src/outputChannel";
import { scheduleWorkspaceSymbolIndexRebuild } from "../../../src/symbolIndex";
import * as workspaceDocuments from "../../../src/symbolIndex/workspaceDocuments";
import { setMockWorkspaceFile, setMockWorkspaceReadFailure } from "../../helpers/vscode";
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
    vi.restoreAllMocks();
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

  it("logs workspace rebuild schema resolution failures before skipping a folder", async () => {
    scheduleWorkspaceSymbolIndexRebuild(
      () => Promise.reject(new Error("schema unavailable")),
      defaultWorkspaceSymbolSettings(),
      4000,
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(
      lines.some(
        (line) =>
          line.includes("Workspace index schema resolution failed (full) for global") &&
          line.includes("skipping folder") &&
          line.includes("schema unavailable"),
      ),
    ).toBe(true);
  });

  it("keeps cap skip accounting in discovery order when disk reads finish out of order", async () => {
    setMockWorkspaceFile("file:///nginx.cfg", "server { listen 80; }");
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");

    const originalLoad = workspaceDocuments.loadDiskEntry;
    vi.spyOn(workspaceDocuments, "loadDiskEntry").mockImplementation(async (uri, ...args) => {
      if (uri.toString() === "file:///nginx.cfg") {
        await Promise.resolve();
        await Promise.resolve();
      }
      return originalLoad(uri, ...args);
    });

    await buildWorkspace(1, Number.POSITIVE_INFINITY);

    expect(lines.some((line) => line.includes("discovered=3, indexed=1"))).toBe(true);
    expect(lines.some((line) => line.includes("skip reasons: not-haproxy-config=1"))).toBe(true);
    expect(lines.some((line) => line.includes("CAPPED (maxFiles)"))).toBe(true);
  });

  it("does not log unreadable prefetched files that are past an earlier cap", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///c.cfg", "backend c\n    server s1 127.0.0.1:80");
    setMockWorkspaceReadFailure("file:///c.cfg", true);

    await buildWorkspace(Number.POSITIVE_INFINITY, 2);

    expect(lines.some((line) => line.includes("CAPPED (maxTotalLines)"))).toBe(true);
    expect(lines.some((line) => line.includes("Skipped unreadable file"))).toBe(false);
    expect(lines.some((line) => line.includes("read-failed"))).toBe(false);
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
