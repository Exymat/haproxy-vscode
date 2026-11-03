import { describe, expect, it, vi } from "vitest";

import { createExtensionWorkspaceSymbolService } from "../../../src/extension/extensionWorkspaceSymbols";
import { getExtensionSettings } from "../../../src/extension/settings";
import { getWorkspaceSymbolIndex } from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  resetMockVscode,
  setMockConfig,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
  workspace,
} from "../../helpers/vscode";
import { createDocument, updateDocument } from "../../helpers/document";
import { loadSchema, loadSchemaBundle } from "../../helpers/schema";
import { provideCompletionItems } from "../../../src/completion";
import { provideDefinition } from "../../../src/navigation";
import { workspaceFolder } from "../workspaceSymbolIndex/helpers";

const schema = loadSchema("3.4");

function createService() {
  const runNow = vi.fn((_document: ReturnType<typeof createDocument>) => {});
  const service = createExtensionWorkspaceSymbolService({
    getSettings: getExtensionSettings,
    getMaxSymbolLines: () => 4000,
    resolveWorkspaceSchema: schema,
    safeEnsureBundle: () => Promise.resolve({ schema } as never),
    scheduler: { runNow, schedule: vi.fn(), clearPending: vi.fn(), disposeDocument: vi.fn() },
    refreshWorkspaceIndexStatusBar: vi.fn(),
  });
  return { service, runNow };
}

describe("workspace root isolation", () => {
  let fixture: ReturnType<typeof createService>;
  const docA = () => createDocument("backend a", "file:///a/a.cfg");
  const docB = () => createDocument("backend b", "file:///b/b.cfg");

  beforeEach(() => {
    vi.useFakeTimers();
    resetMockVscode();
    setMockWorkspaceFolders([
      workspaceFolder("file:///a"),
      workspaceFolder("file:///b"),
      workspaceFolder("file:///c"),
    ]);
    setMockConfig("haproxy", "workspaceSymbols.debounceMs", 100);
    fixture = createService();
  });

  afterEach(() => {
    fixture.service.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function seedDocuments() {
    const documents = [docA(), docB(), createDocument("backend c", "file:///c/c.cfg")];
    for (const document of documents) {
      setMockWorkspaceFile(document.uri.toString(), document.getText());
      mockTextDocuments.push(document as never);
    }
    await fixture.service.schedule("full");
    await vi.runAllTimersAsync();
    fixture.runNow.mockClear();
    return documents;
  }

  it("keeps root C completions and definitions isolated before and after an edit in root A", async () => {
    const frontend = createDocument("frontend web\n    default_backend ", "file:///c/frontend.cfg");
    setMockWorkspaceFile(frontend.uri.toString(), frontend.getText());
    mockTextDocuments.push(frontend as never);
    const [a] = await seedDocuments();
    const originalC = getWorkspaceSymbolIndex(frontend);
    const languageData = loadSchemaBundle("3.4").languageData;
    const position = { line: 1, character: "    default_backend ".length } as never;
    const labels = async () =>
      (await provideCompletionItems(frontend, position, languageData, schema)).map(
        (item) => item.label,
      );
    expect(await labels()).toEqual(["c"]);

    updateDocument(a, "backend renamed_in_a");
    await fixture.service.schedule("incremental", a);
    await vi.runAllTimersAsync();
    expect(getWorkspaceSymbolIndex(frontend)).toBe(originalC);
    expect(fixture.runNow).toHaveBeenCalledExactlyOnceWith(a);
    expect(await labels()).toEqual(["c"]);

    updateDocument(frontend, "frontend web\n    default_backend renamed_in_a");
    expect(
      provideDefinition(frontend, { line: 1, character: 24 } as never, schema, 4000),
    ).toBeNull();
  });

  it("refreshes only the owning root after a watcher content event", async () => {
    const [a, b] = await seedDocuments();
    const unrelatedIndex = getWorkspaceSymbolIndex(b);
    updateDocument(a, "backend renamed");
    await fixture.service.scheduleForUri(a.uri, "content");
    await vi.runAllTimersAsync();
    expect(fixture.runNow).toHaveBeenCalledExactlyOnceWith(a);
    expect(getWorkspaceSymbolIndex(b)).toBe(unrelatedIndex);
  });

  it("refreshes every edited root in one debounced incremental batch", async () => {
    const [a, b] = await seedDocuments();
    updateDocument(a, "backend a2");
    updateDocument(b, "backend b2");
    await fixture.service.schedule("incremental", a);
    await fixture.service.schedule("incremental", b);
    await vi.runAllTimersAsync();
    expect(fixture.runNow.mock.calls.map(([document]) => document)).toEqual([a, b]);
  });

  it("does not lose incremental notifications when another root needs discovery", async () => {
    const [a, b] = await seedDocuments();
    updateDocument(a, "backend a2");
    updateDocument(b, "backend b2");
    await fixture.service.schedule("incremental", a);
    await fixture.service.schedule("full", undefined, b.uri);
    await vi.runAllTimersAsync();
    expect(fixture.runNow.mock.calls.map(([document]) => document)).toEqual([a, b]);
  });

  it("keeps the incremental notification when a same-root content refresh finds no further changes", async () => {
    const [a] = await seedDocuments();
    updateDocument(a, "backend a2");
    await fixture.service.schedule("incremental", a);
    await fixture.service.schedule("content", undefined, a.uri);
    await vi.runAllTimersAsync();
    expect(fixture.runNow).toHaveBeenCalledExactlyOnceWith(a);
  });

  it("ignores duplicate watcher events and preserves diagnostic graph revisions", async () => {
    const [a] = await seedDocuments();
    const revision = getWorkspaceSymbolIndex(a)?.revision;
    await fixture.service.scheduleForUri(a.uri, "content");
    await vi.runAllTimersAsync();
    expect(fixture.runNow).not.toHaveBeenCalled();
    expect(getWorkspaceSymbolIndex(a)?.revision).toBe(revision);
  });

  it.each([
    { setting: "workspaceSymbols.maxTotalLines", limit: 100, comments: "# comment\n".repeat(101) },
    {
      setting: "workspaceSymbols.maxTotalBytes",
      limit: 102400,
      comments: `# ${"x".repeat(1000)}\n`.repeat(120),
    },
  ])(
    "enforces $setting even when an edit only adds comments",
    async ({ setting, limit, comments }) => {
      setMockConfig("haproxy", setting, limit);
      const [a, b] = await seedDocuments();
      const unrelated = getWorkspaceSymbolIndex(b);
      updateDocument(a, `backend a\n${comments}`);
      await fixture.service.schedule("incremental", a);
      await vi.runAllTimersAsync();
      expect(getWorkspaceSymbolIndex(a)).toBeNull();
      expect(getWorkspaceSymbolIndex(b)).toBe(unrelated);
      expect(fixture.runNow).toHaveBeenCalledExactlyOnceWith(a);
    },
  );

  it("keeps existing watchers when an independent root is added or removed", () => {
    const watchers: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const createWatcher = vi.spyOn(workspace, "createFileSystemWatcher").mockImplementation(() => {
      const watcher = {
        onDidCreate: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose: vi.fn(),
      };
      watchers.push(watcher);
      return watcher as never;
    });
    fixture.service.configureWatchers();
    expect(createWatcher).toHaveBeenCalledTimes(3);
    setMockWorkspaceFolders([workspaceFolder("file:///a"), workspaceFolder("file:///b")]);
    fixture.service.handleWorkspaceFoldersChanged();
    expect(createWatcher).toHaveBeenCalledTimes(3);
    expect(watchers[0]?.dispose).not.toHaveBeenCalled();
    expect(watchers[1]?.dispose).not.toHaveBeenCalled();
    expect(watchers[2]?.dispose).toHaveBeenCalledOnce();
  });

  it("refreshes only documents from a removed root for single-file fallback", async () => {
    const [a] = await seedDocuments();
    setMockWorkspaceFolders([workspaceFolder("file:///b"), workspaceFolder("file:///c")]);
    fixture.service.handleWorkspaceFoldersChanged();
    await vi.runAllTimersAsync();
    expect(fixture.runNow).toHaveBeenCalledExactlyOnceWith(a);
  });

  it("drops events from a parent watcher when a nested root owns the changed file", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///a"), workspaceFolder("file:///a/child")]);
    const changes: Array<(uri: unknown) => void> = [];
    vi.spyOn(workspace, "createFileSystemWatcher").mockImplementation(
      () =>
        ({
          onDidCreate: () => ({ dispose() {} }),
          onDidDelete: () => ({ dispose() {} }),
          onDidChange: (listener: (uri: unknown) => void) => {
            changes.push(listener);
            return { dispose() {} };
          },
          dispose() {},
        }) as never,
    );
    fixture.service.configureWatchers();
    const findFiles = vi.spyOn(workspace, "findFiles").mockClear();
    changes[0]?.(createDocument("backend child", "file:///a/child/new.cfg").uri);
    await vi.runAllTimersAsync();
    expect(findFiles).not.toHaveBeenCalled();
  });
});
