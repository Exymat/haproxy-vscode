import { describe, expect, it } from "vitest";

import {
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  isWorkspaceRebuildPending,
  resolveWorkspaceRebuildScopeOnOpen,
  removeWorkspaceSymbolFolders,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
} from "../../../src/symbolIndex";
import { setMockWorkspaceFile, setMockWorkspaceFolders, workspace } from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";
import {
  rethrowUnlessStaleWorkspaceGeneration,
  StaleWorkspaceGenerationError,
} from "../../../src/symbolIndex/workspaceState";
import {
  defaultWorkspaceSymbolSettings,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "../workspaceSymbolIndex/helpers";

const schema = loadSchema("3.4");
const delayedSettings = () => defaultWorkspaceSymbolSettings({ debounceMs: 10 });

type TestDocument = ReturnType<typeof createDocument>;
type SchemaFolder = { uri: { toString(): string } } | undefined;

function setMockWorkspaceFiles(documents: TestDocument[]): void {
  for (const document of documents) {
    setMockWorkspaceFile(document.uri.toString(), document.getText());
  }
}

async function flushRebuildTimers(): Promise<void> {
  await vi.runAllTimersAsync();
  await Promise.resolve();
}

async function advanceRebuildDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(10);
  await Promise.resolve();
}

async function seedFolderIndex(document: TestDocument): Promise<void> {
  scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
    scope: "full",
    uri: document.uri,
  });
  await flushRebuildTimers();
}

function blockedSchemaSource(blockedFolderUri = "file:///folder-a"): {
  releaseSchemaLoad: () => void;
  schemaSource: (folder: SchemaFolder) => Promise<typeof schema>;
} {
  let releaseSchemaLoad: () => void = () => {};
  const firstSchemaLoad = new Promise<void>((resolve) => {
    releaseSchemaLoad = resolve;
  });
  let blockOnce = true;
  const schemaSource = vi.fn(async (folder: SchemaFolder) => {
    if (folder?.uri.toString() === blockedFolderUri && blockOnce) {
      blockOnce = false;
      await firstSchemaLoad;
    }
    return schema;
  });
  return { releaseSchemaLoad, schemaSource };
}

describe("workspaceRebuild scheduling", () => {
  setupWorkspaceSymbolIndexTests();

  it("marks rebuild pending until timers flush", () => {
    clearWorkspaceSymbolIndex();
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    expect(isWorkspaceRebuildPending()).toBe(true);
  });

  it("swallows only stale-generation cancellation errors", () => {
    expect(() =>
      rethrowUnlessStaleWorkspaceGeneration(new StaleWorkspaceGenerationError()),
    ).not.toThrow();
    expect(() => rethrowUnlessStaleWorkspaceGeneration(new Error("real failure"))).toThrow(
      "real failure",
    );
  });

  it("resolves open scope to none for non-haproxy documents", () => {
    const document = createDocument("plain text", "file:///a.txt");
    Object.defineProperty(document, "languageId", { value: "plaintext" });
    expect(resolveWorkspaceRebuildScopeOnOpen(document)).toBe("none");
  });

  it("resolves open scope to full when workspace index is missing", () => {
    const document = createDocument("backend api", "file:///a.cfg");
    Object.defineProperty(document, "languageId", { value: "haproxy-3.4" });
    expect(resolveWorkspaceRebuildScopeOnOpen(document)).toBe("full");
  });

  it("clears pending state after rebuild runs", async () => {
    clearWorkspaceSymbolIndex();
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await flushRebuildTimers();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("clears the active workspace index when workspace symbols are disabled", async () => {
    const listener = vi.fn();
    setMockWorkspaceFile("file:///a.cfg", "backend api\n    server s1 127.0.0.1:80");
    setWorkspaceSymbolIndexChangeListener(listener);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000);
    await flushRebuildTimers();
    expect(getWorkspaceSymbolIndex()).not.toBeNull();

    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({ enabled: false }),
      4000,
    );
    await flushRebuildTimers();

    expect(getWorkspaceSymbolIndex()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "full" }));
  });

  it.each([false, true])(
    "keeps folder rediscovery when merged with workspace content work (content first: %s)",
    async (contentFirst) => {
      const a = createDocument("backend a", "file:///folder-a/a.cfg");
      const b = createDocument("backend b", "file:///folder-b/b.cfg");
      setMockWorkspaceFolders([
        workspaceFolder("file:///folder-a"),
        workspaceFolder("file:///folder-b"),
      ]);
      setMockWorkspaceFiles([a, b]);
      scheduleWorkspaceSymbolIndexRebuild(schema, delayedSettings(), 4000);
      await flushRebuildTimers();
      const added = createDocument("backend new", "file:///folder-a/new.cfg");
      setMockWorkspaceFiles([added]);
      const content = () =>
        scheduleWorkspaceSymbolIndexRebuild(schema, delayedSettings(), 4000, { scope: "content" });
      const full = () =>
        scheduleWorkspaceSymbolIndexRebuild(schema, delayedSettings(), 4000, {
          scope: "full",
          uri: a.uri,
        });
      if (contentFirst) {
        content();
        full();
      } else {
        full();
        content();
      }
      await flushRebuildTimers();
      expect(getWorkspaceSymbolIndex(a)?.documents.has(added.uri.toString())).toBe(true);
    },
  );

  it("notifies only the failed root when a schema error removes its previous index", async () => {
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    const b = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([a, b]);
    scheduleWorkspaceSymbolIndexRebuild(schema, delayedSettings(), 4000);
    await flushRebuildTimers();
    const unrelated = getWorkspaceSymbolIndex(b);
    const listener = vi.fn();
    setWorkspaceSymbolIndexChangeListener(listener);
    const failSchema = () => Promise.reject(new Error("schema unavailable"));
    scheduleWorkspaceSymbolIndexRebuild(failSchema, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    await flushRebuildTimers();
    expect(getWorkspaceSymbolIndex(a)).toBeNull();
    expect(getWorkspaceSymbolIndex(b)).toBe(unrelated);
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0]?.[0] as { uri: { toString(): string } }).uri.toString()).toBe(
      "file:///folder-a",
    );
  });

  it("does not cancel an independent root while it is rebuilding", async () => {
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    const b = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([a, b]);
    const { schemaSource, releaseSchemaLoad } = blockedSchemaSource();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    await advanceRebuildDebounce();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: b.uri,
    });
    await advanceRebuildDebounce();
    expect(isWorkspaceRebuildPending()).toBe(true);
    expect(schemaSource).toHaveBeenCalledTimes(1);
    releaseSchemaLoad();
    await flushRebuildTimers();
    expect(schemaSource).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSymbolIndex(a)?.documents.has(a.uri.toString())).toBe(true);
    expect(getWorkspaceSymbolIndex(b)?.documents.has(b.uri.toString())).toBe(true);
  });

  it("does not repeat completed roots when a workspace build is superseded", async () => {
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    const b = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([a, b]);
    const { schemaSource, releaseSchemaLoad } = blockedSchemaSource("file:///folder-b");
    const findFiles = vi.spyOn(workspace, "findFiles").mockClear();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000);
    await advanceRebuildDebounce();
    const completed = getWorkspaceSymbolIndex(a);
    expect(completed).not.toBeNull();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: b.uri,
    });
    releaseSchemaLoad();
    await flushRebuildTimers();
    expect(getWorkspaceSymbolIndex(a)).toBe(completed);
    expect(
      findFiles.mock.calls.filter(
        ([pattern]) =>
          typeof pattern !== "string" &&
          "baseUri" in pattern &&
          pattern.baseUri.toString() === "file:///folder-a",
      ),
    ).toHaveLength(1);
    expect(getWorkspaceSymbolIndex(b)?.documents.has(b.uri.toString())).toBe(true);
  });

  it("cancels a stale same-root build without publishing it", async () => {
    const a = createDocument("backend old", "file:///folder-a/a.cfg");
    setMockWorkspaceFolders([workspaceFolder("file:///folder-a")]);
    setMockWorkspaceFiles([a]);
    const { schemaSource, releaseSchemaLoad } = blockedSchemaSource();
    const listener = vi.fn();
    setWorkspaceSymbolIndexChangeListener(listener);
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    await advanceRebuildDebounce();
    setMockWorkspaceFile(a.uri.toString(), "backend new");
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    await advanceRebuildDebounce();
    releaseSchemaLoad();
    await flushRebuildTimers();
    expect(listener).toHaveBeenCalledOnce();
    expect(getWorkspaceSymbolIndex(a)?.definitions.has("proxy-section:new")).toBe(true);
    expect(getWorkspaceSymbolIndex(a)?.definitions.has("proxy-section:old")).toBe(false);
  });

  it("does not run deferred root work after the index is cleared", async () => {
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    const b = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([a, b]);
    const { schemaSource, releaseSchemaLoad } = blockedSchemaSource();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    await advanceRebuildDebounce();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: b.uri,
    });
    await advanceRebuildDebounce();
    clearWorkspaceSymbolIndex();
    releaseSchemaLoad();
    await flushRebuildTimers();
    expect(schemaSource).toHaveBeenCalledOnce();
    expect(getWorkspaceSymbolIndex(a)).toBeNull();
    expect(getWorkspaceSymbolIndex(b)).toBeNull();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("reschedules in-flight folder rebuilds when another folder schedules work", async () => {
    const docA = createDocument("backend a", "file:///folder-a/a.cfg");
    const docB = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([docA, docB]);
    const { releaseSchemaLoad, schemaSource } = blockedSchemaSource();
    const settings = delayedSettings();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docA.uri,
    });
    await advanceRebuildDebounce();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docB.uri,
    });
    releaseSchemaLoad();
    await advanceRebuildDebounce();
    await flushRebuildTimers();

    expect(getWorkspaceSymbolIndex(docA)?.documents.has(docA.uri.toString())).toBe(true);
    expect(getWorkspaceSymbolIndex(docB)?.documents.has(docB.uri.toString())).toBe(true);
  });

  it("does not restart a surviving root or restore removed indexes after unrelated root removal", async () => {
    const folderA = workspaceFolder("file:///folder-a");
    const folderB = workspaceFolder("file:///folder-b");
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    const b = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([folderA, folderB]);
    setMockWorkspaceFiles([a, b]);
    await seedFolderIndex(b);
    const { schemaSource, releaseSchemaLoad } = blockedSchemaSource();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    await advanceRebuildDebounce();
    setMockWorkspaceFolders([folderA]);
    removeWorkspaceSymbolFolders([folderB.uri] as never);
    releaseSchemaLoad();
    await flushRebuildTimers();
    expect(schemaSource).toHaveBeenCalledOnce();
    expect(getWorkspaceSymbolIndex(a)?.documents.has(a.uri.toString())).toBe(true);
    setMockWorkspaceFolders([folderA, folderB]);
    expect(getWorkspaceSymbolIndex(b)).toBeNull();
  });

  it("keeps queued edits for a surviving nested root when its parent is removed", async () => {
    const parent = workspaceFolder("file:///parent");
    const child = workspaceFolder("file:///parent/child");
    const old = createDocument("backend old", "file:///parent/child/a.cfg");
    const edited = createDocument("backend edited", "file:///parent/child/a.cfg");
    setMockWorkspaceFolders([parent, child]);
    setMockWorkspaceFiles([old]);
    await seedFolderIndex(old);
    scheduleWorkspaceSymbolIndexRebuild(schema, delayedSettings(), 4000, {
      scope: "incremental",
      document: edited,
    });
    setMockWorkspaceFolders([child]);
    removeWorkspaceSymbolFolders([parent.uri] as never);
    await flushRebuildTimers();
    expect(getWorkspaceSymbolIndex(edited)?.definitions.has("proxy-section:edited")).toBe(true);
  });

  it("skips a queued folder if ownership disappears before the folder-change callback runs", async () => {
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    const b = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([a, b]);
    const resolveSchema = vi.fn(() => Promise.resolve(schema));
    scheduleWorkspaceSymbolIndexRebuild(resolveSchema, delayedSettings(), 4000, {
      scope: "full",
      uri: a.uri,
    });
    setMockWorkspaceFolders([workspaceFolder("file:///folder-b")]);
    await flushRebuildTimers();
    expect(resolveSchema).not.toHaveBeenCalled();
    expect(getWorkspaceSymbolIndex(b)).toBeNull();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("drops queued document edits when their root is removed", async () => {
    const folderA = workspaceFolder("file:///folder-a");
    const folderB = workspaceFolder("file:///folder-b");
    const a = createDocument("backend a", "file:///folder-a/a.cfg");
    setMockWorkspaceFolders([folderA, folderB]);
    const resolveSchema = vi.fn(() => Promise.resolve(schema));
    scheduleWorkspaceSymbolIndexRebuild(resolveSchema, delayedSettings(), 4000, {
      scope: "incremental",
      document: a,
    });
    setMockWorkspaceFolders([folderB]);
    removeWorkspaceSymbolFolders([folderA.uri] as never);
    await flushRebuildTimers();
    expect(resolveSchema).not.toHaveBeenCalled();
    expect(isWorkspaceRebuildPending()).toBe(false);
  });

  it("cancels a removed folder rebuild while preserving queued work for other roots", async () => {
    const folderA = workspaceFolder("file:///folder-a");
    const folderB = workspaceFolder("file:///folder-b");
    const docA = createDocument("backend a", "file:///folder-a/a.cfg");
    const docB = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([folderA, folderB]);
    setMockWorkspaceFiles([docA, docB]);
    const { releaseSchemaLoad, schemaSource } = blockedSchemaSource();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: docA.uri,
    });
    await advanceRebuildDebounce();
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, delayedSettings(), 4000, {
      scope: "full",
      uri: docB.uri,
    });
    setMockWorkspaceFolders([folderB]);
    removeWorkspaceSymbolFolders([folderA.uri] as never);
    releaseSchemaLoad();
    await flushRebuildTimers();
    expect(getWorkspaceSymbolIndex(docB)?.documents.has(docB.uri.toString())).toBe(true);
    expect(getWorkspaceSymbolIndex(docA)).toBeNull();
  });

  it("does not publish a stale in-flight workspace generation", async () => {
    const docA = createDocument("backend a", "file:///folder-a/a.cfg");
    const docB = createDocument("backend b", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([docA, docB]);
    const { releaseSchemaLoad, schemaSource } = blockedSchemaSource();
    const listener = vi.fn();
    setWorkspaceSymbolIndexChangeListener(listener);
    const settings = delayedSettings();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docA.uri,
    });
    await advanceRebuildDebounce();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docB.uri,
    });
    releaseSchemaLoad();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();

    await advanceRebuildDebounce();
    await flushRebuildTimers();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getWorkspaceSymbolIndex(docA)?.documents.has(docA.uri.toString())).toBe(true);
    expect(getWorkspaceSymbolIndex(docB)?.documents.has(docB.uri.toString())).toBe(true);
  });

  it("keeps queued incremental work when an in-flight folder rebuild is rescheduled", async () => {
    const docA = createDocument("backend a", "file:///folder-a/a.cfg");
    const docBOld = createDocument("backend old", "file:///folder-b/b.cfg");
    const docB = createDocument("backend updated", "file:///folder-b/b.cfg");
    const docC = createDocument("backend c", "file:///folder-c/c.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
      workspaceFolder("file:///folder-c"),
    ]);
    setMockWorkspaceFiles([docA, docBOld, docC]);
    await seedFolderIndex(docBOld);
    expect(getWorkspaceSymbolIndex(docBOld)?.definitions.get("proxy-section:old")).toHaveLength(1);

    const { releaseSchemaLoad, schemaSource } = blockedSchemaSource();
    const settings = delayedSettings();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docA.uri,
    });
    await advanceRebuildDebounce();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "incremental",
      document: docB,
    });
    setMockWorkspaceFile(docB.uri.toString(), docB.getText());
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docC.uri,
    });
    releaseSchemaLoad();
    await advanceRebuildDebounce();
    await flushRebuildTimers();

    expect(getWorkspaceSymbolIndex(docA)?.documents.has(docA.uri.toString())).toBe(true);
    expect(getWorkspaceSymbolIndex(docB)?.documents.has(docB.uri.toString())).toBe(true);
    expect(getWorkspaceSymbolIndex(docB)?.definitions.get("proxy-section:old")).toBeUndefined();
    expect(getWorkspaceSymbolIndex(docB)?.definitions.get("proxy-section:updated")).toHaveLength(1);
    expect(getWorkspaceSymbolIndex(docC)?.documents.has(docC.uri.toString())).toBe(true);
  });

  it("preserves queued incremental updates when workspace content rebuild supersedes in-flight work", async () => {
    const docA = createDocument("backend a", "file:///folder-a/a.cfg");
    const docBOld = createDocument("backend old", "file:///folder-b/b.cfg");
    const docB = createDocument("backend updated", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([docA, docBOld]);
    await seedFolderIndex(docBOld);

    const { releaseSchemaLoad, schemaSource } = blockedSchemaSource();
    const settings = delayedSettings();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docA.uri,
    });
    await advanceRebuildDebounce();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, { scope: "content" });
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "incremental",
      document: docB,
    });
    setMockWorkspaceFile(docB.uri.toString(), docB.getText());
    releaseSchemaLoad();
    await advanceRebuildDebounce();
    await flushRebuildTimers();

    expect(getWorkspaceSymbolIndex(docB)?.definitions.get("proxy-section:old")).toBeUndefined();
    expect(getWorkspaceSymbolIndex(docB)?.definitions.get("proxy-section:updated")).toHaveLength(1);
  });

  it("preserves queued incremental updates when workspace full rebuild supersedes in-flight work", async () => {
    const docA = createDocument("backend a", "file:///folder-a/a.cfg");
    const docBOld = createDocument("backend old", "file:///folder-b/b.cfg");
    const docB = createDocument("backend updated", "file:///folder-b/b.cfg");
    setMockWorkspaceFolders([
      workspaceFolder("file:///folder-a"),
      workspaceFolder("file:///folder-b"),
    ]);
    setMockWorkspaceFiles([docA, docBOld]);
    await seedFolderIndex(docBOld);

    const { releaseSchemaLoad, schemaSource } = blockedSchemaSource();
    const settings = delayedSettings();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "full",
      uri: docA.uri,
    });
    await advanceRebuildDebounce();

    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000);
    scheduleWorkspaceSymbolIndexRebuild(schemaSource, settings, 4000, {
      scope: "incremental",
      document: docB,
    });
    setMockWorkspaceFile(docB.uri.toString(), docB.getText());
    releaseSchemaLoad();
    await advanceRebuildDebounce();
    await flushRebuildTimers();

    expect(getWorkspaceSymbolIndex(docB)?.definitions.get("proxy-section:old")).toBeUndefined();
    expect(getWorkspaceSymbolIndex(docB)?.definitions.get("proxy-section:updated")).toHaveLength(1);
  });
});
