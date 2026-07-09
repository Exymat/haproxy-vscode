import {
  getWorkspaceSymbolIndex,
  isUriExcludedFromWorkspaceSymbols,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
  workspaceEntryForDocument,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFileStat,
  setMockWorkspaceFolders,
  setMockWorkspaceReadFailure,
  Uri,
  workspace,
} from "../../__mocks__/vscode";
import { createDocument, updateDocument } from "../../helpers/document";

import {
  buildWorkspace,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "./helpers";

const workspaceSettings = {
  enabled: true,
  include: ["**/*.cfg"],
  exclude: [] as string[],
  maxFiles: 1000,
  maxTotalLines: 100000,
  debounceMs: 100,
};

describe("workspace symbol coverage paths", () => {
  setupWorkspaceSymbolIndexTests();

  it("resolves open scope for non-haproxy and missing entries", () => {
    expect(
      resolveWorkspaceRebuildScopeOnOpen({
        languageId: "plaintext",
        uri: { toString: () => "file:///x.cfg" },
      } as never),
    ).toBe("none");

    const missing = createDocument("backend api", "file:///missing.cfg");
    expect(resolveWorkspaceRebuildScopeOnOpen(missing)).toBe("full");
  });

  it("uses global folder targeting when no sticky folders or open docs exist", async () => {
    setMockWorkspaceFile("file:///solo.cfg", "backend solo");

    scheduleWorkspaceSymbolIndexRebuild(schema, workspaceSettings, 4000, {
      scope: "content",
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(expectWorkspaceIndex(getWorkspaceSymbolIndex())?.documents.has("file:///solo.cfg")).toBe(
      true,
    );
  });

  it("ignores sticky folder keys that no longer exist in the workspace", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///repo")]);
    setMockWorkspaceFile("file:///repo/a.cfg", "backend a");
    const doc = createDocument("backend a", "file:///repo/a.cfg");
    mockTextDocuments.push(doc as never);
    await buildWorkspace();

    setMockWorkspaceFolders([]);
    mockTextDocuments.length = 0;

    scheduleWorkspaceSymbolIndexRebuild(schema, workspaceSettings, 4000, { scope: "content" });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(getWorkspaceSymbolIndex()).toBeNull();
  });

  it("returns full scope when reopening a document missing from the workspace index", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    await buildWorkspace();
    expect(resolveWorkspaceRebuildScopeOnOpen(createDocument("backend b", "file:///b.cfg"))).toBe(
      "full",
    );
  });

  it("falls back to the global workspace folder when nothing is indexed yet", async () => {
    setMockWorkspaceFolders([workspaceFolder("file:///repo")]);
    mockTextDocuments.length = 0;
    setMockWorkspaceFile("file:///solo.cfg", "backend solo");

    scheduleWorkspaceSymbolIndexRebuild(schema, workspaceSettings, 4000, {
      scope: "content",
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(expectWorkspaceIndex(getWorkspaceSymbolIndex())?.documents.has("file:///solo.cfg")).toBe(
      true,
    );
  });

  it("matches exclude globs with question marks, brace expansion, and loose ** patterns", () => {
    const folder = {
      uri: Uri.file("file:///repo"),
      name: "repo",
      index: 0,
    };
    const settings = {
      ...workspaceSettings,
      exclude: ["**/v?ndor/**", "tmp/**", "**/vendor", "*.cfg"],
    };

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/vendor/pkg/x.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/tmp/x.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/nested/vendor") as never,
        settings,
        folder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/haproxy.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        { fsPath: undefined, toString: () => "file:///repo/cache/x.cfg" } as never,
        settings,
        undefined,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache/x.cfg") as never,
        { ...settings, exclude: ["{tmp,cache}/**"] },
        folder as never,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/haproxy.cfg") as never,
        { ...settings, exclude: ["{haproxy.cfg,cache.cfg}"] },
        folder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache/x.cfg") as never,
        { ...settings, exclude: ["**/cache/**"] },
        undefined,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo") as never,
        settings,
        folder as never,
      ),
    ).toBe(false);
  });

  it("evicts disk entries when reads fail after stat changes", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    await buildWorkspace();
    setMockWorkspaceFileStat("file:///a.cfg", Date.now() + 5000, 999);
    setMockWorkspaceReadFailure("file:///a.cfg", true);

    await buildWorkspace();
    expect(expectWorkspaceIndex(getWorkspaceSymbolIndex())?.documents.has("file:///a.cfg")).toBe(
      false,
    );
  });

  it("falls back to content rebuild when incremental update hits a capped index", async () => {
    setMockWorkspaceFile("file:///api.cfg", "backend api");
    const doc = createDocument("backend api", "file:///api.cfg");
    mockTextDocuments.push(doc as never);

    scheduleWorkspaceSymbolIndexRebuild(schema, { ...workspaceSettings, maxFiles: 0 }, 4000, {
      scope: "full",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const findFilesSpy = vi.spyOn(workspace, "findFiles");
    updateDocument(doc, "backend renamed");
    scheduleWorkspaceSymbolIndexRebuild(schema, workspaceSettings, 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(findFilesSpy).toHaveBeenCalled();
  });

  it("removes workspace entries when incremental updates produce no symbols", async () => {
    setMockWorkspaceFile("file:///api.cfg", "backend api");
    const doc = createDocument("backend api", "file:///api.cfg");
    mockTextDocuments.push(doc as never);
    await buildWorkspace();

    Object.defineProperty(doc, "languageId", { value: "plaintext" });
    scheduleWorkspaceSymbolIndexRebuild(schema, workspaceSettings, 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(workspaceEntryForDocument(doc)).toBeUndefined();
  });

  it("caps the workspace graph when incremental updates exceed total line limits", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");
    const doc = createDocument("backend a\n    server s1 127.0.0.1:80", "file:///a.cfg");
    mockTextDocuments.push(doc as never);
    await buildWorkspace(1000, 4);

    updateDocument(doc, "backend a\n    server s1 127.0.0.1:80\n    server s2 127.0.0.1:81");
    scheduleWorkspaceSymbolIndexRebuild(schema, { ...workspaceSettings, maxTotalLines: 4 }, 4000, {
      scope: "incremental",
      document: doc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(getWorkspaceSymbolIndex(doc)).toBeNull();
  });
});
