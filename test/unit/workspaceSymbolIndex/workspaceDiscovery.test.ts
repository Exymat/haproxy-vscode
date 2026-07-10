import {
  getDiscoveredUris,
  getDiscoveryResult,
  GLOBAL_WORKSPACE_FOLDER_KEY,
} from "../../../src/symbolIndex/workspaceDiscovery";
import { getWorkspaceSymbolIndex, hasCappedWorkspaceFolders } from "../../../src/symbolIndex";
import {
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
  Uri,
  workspace,
} from "../../__mocks__/vscode";

import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  workspaceFolder,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("workspace symbol discovery bounds", () => {
  setupWorkspaceSymbolIndexTests();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes maxFiles plus one to findFiles when maxFiles is finite", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    setMockWorkspaceFile("file:///b.cfg", "backend b");
    setMockWorkspaceFile("file:///c.cfg", "backend c");
    const findFilesSpy = vi.spyOn(workspace, "findFiles");

    const result = await getDiscoveryResult(
      defaultWorkspaceSymbolSettings({ maxFiles: 2 }),
      undefined,
      GLOBAL_WORKSPACE_FOLDER_KEY,
      true,
    );

    expect(findFilesSpy).toHaveBeenCalledWith("**/*.cfg", undefined, 3);
    expect(result.uris).toHaveLength(3);
    expect(result.capped).toBe(true);
  });

  it("leaves findFiles unbounded when maxFiles is zero or infinite", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    const findFilesSpy = vi.spyOn(workspace, "findFiles");

    await getDiscoveryResult(
      defaultWorkspaceSymbolSettings({ maxFiles: 0 }),
      undefined,
      GLOBAL_WORKSPACE_FOLDER_KEY,
      true,
    );
    await getDiscoveryResult(
      defaultWorkspaceSymbolSettings({ maxFiles: Number.POSITIVE_INFINITY }),
      undefined,
      GLOBAL_WORKSPACE_FOLDER_KEY,
      true,
    );

    expect(findFilesSpy).toHaveBeenNthCalledWith(1, "**/*.cfg", undefined);
    expect(findFilesSpy).toHaveBeenNthCalledWith(2, "**/*.cfg", undefined);
  });

  it("caps over-limit discovery after reading only the bounded discovery window", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    setMockWorkspaceFile("file:///b.cfg", "backend b");
    setMockWorkspaceFile("file:///c.cfg", "backend c");
    const readFileSpy = vi.spyOn(workspace.fs, "readFile");

    await buildWorkspace(1);

    expect(getWorkspaceSymbolIndex()).toBeNull();
    expect(hasCappedWorkspaceFolders()).toBe(true);
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });

  it("filters folder-scoped discovery results that belong to another workspace folder", async () => {
    const folderA = workspaceFolder("file:///folder-a");
    const folderB = workspaceFolder("file:///folder-b");
    setMockWorkspaceFolders([folderA, folderB]);

    vi.spyOn(workspace, "findFiles").mockResolvedValue([
      Uri.file("file:///folder-a/a.cfg"),
      Uri.file("file:///folder-b/b.cfg"),
    ]);

    const result = await getDiscoveryResult(
      defaultWorkspaceSymbolSettings(),
      folderA as never,
      "file:///folder-a",
      true,
    );

    expect(result.uris.map((uri) => uri.toString())).toEqual(["file:///folder-a/a.cfg"]);
    expect(result.capped).toBe(false);
  });

  it("returns only URIs from getDiscoveredUris", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");

    const uris = await getDiscoveredUris(
      defaultWorkspaceSymbolSettings(),
      undefined,
      GLOBAL_WORKSPACE_FOLDER_KEY,
      true,
    );

    expect(uris.map((uri) => uri.toString())).toEqual(["file:///a.cfg"]);
  });

  it("handles nested and unmatched brace exclude patterns", async () => {
    const folder = workspaceFolder("file:///repo");
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["{tmp,{cache,run}}/**", "{literal", "{single}/**"],
    });

    setMockWorkspaceFile("file:///repo/cache/a.cfg", "backend cache");
    setMockWorkspaceFile("file:///repo/run/a.cfg", "backend run");
    setMockWorkspaceFile("file:///repo/{literal/a.cfg", "backend literal");
    setMockWorkspaceFile("file:///repo/{single}/a.cfg", "backend single");

    await expect(
      getDiscoveryResult(settings, folder as never, "file:///repo", true),
    ).resolves.toMatchObject({
      uris: [],
      capped: false,
    });
  });
});
