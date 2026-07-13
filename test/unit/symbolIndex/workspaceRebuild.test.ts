import { describe, expect, it } from "vitest";

import {
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  isWorkspaceRebuildPending,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
} from "../../../src/symbolIndex";
import { setMockWorkspaceFile, setMockWorkspaceFolders } from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";
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
