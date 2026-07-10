import * as buildModule from "../../../src/symbolIndex/build";
import { createDiskEntry, loadDiskEntry } from "../../../src/symbolIndex/workspaceDocuments";
import {
  setMockWorkspaceFile,
  setMockWorkspaceFileStat,
  Uri,
  workspace,
} from "../../helpers/vscode";

import { schema, setupWorkspaceSymbolIndexTests } from "./helpers";

describe("createDiskEntry size guards", () => {
  setupWorkspaceSymbolIndexTests();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips readFile when stat.size exceeds the byte ceiling", async () => {
    const maxLines = 100;
    const maxFileBytes = 1_000_000;
    const path = "file:///huge.cfg";
    setMockWorkspaceFile(path, "backend tiny");
    setMockWorkspaceFileStat(path, Date.now(), maxFileBytes + 1);

    const readFileSpy = vi.spyOn(workspace.fs, "readFile");
    const result = await createDiskEntry(Uri.file(path) as never, schema, maxLines, undefined, {
      maxFileBytes,
      maxLineBytes: Number.POSITIVE_INFINITY,
    });

    expect(result).toBeNull();
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("skips a cached disk entry when stat.size exceeds a lowered byte ceiling", async () => {
    const path = "file:///cached-huge.cfg";
    const mtime = Date.now();
    setMockWorkspaceFile(path, "backend cached");
    setMockWorkspaceFileStat(path, mtime, 20_000);
    const cached = await createDiskEntry(Uri.file(path) as never, schema, 100, undefined, {
      maxFileBytes: 30_000,
      maxLineBytes: Number.POSITIVE_INFINITY,
    });
    expect(cached).not.toBeNull();
    if (!cached) {
      throw new Error("Expected cached disk entry");
    }

    const readFileSpy = vi.spyOn(workspace.fs, "readFile");
    const result = await loadDiskEntry(Uri.file(path) as never, schema, 100, cached, {
      maxFileBytes: 10_000,
      maxLineBytes: Number.POSITIVE_INFINITY,
    });

    expect(result.entry).toBeNull();
    expect(result.skipReason).toBe("file-too-large");
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("returns null when line count exceeds maxLines without building symbols", async () => {
    const maxLines = 5;
    const path = "file:///many-lines.cfg";
    const lines = Array.from(
      { length: maxLines + 1 },
      (_, index) => `    server s${index} 127.0.0.1:80`,
    );
    const content = `backend api\n${lines.join("\n")}`;
    setMockWorkspaceFile(path, content);

    const buildSpy = vi.spyOn(buildModule, "buildSymbolIndex");
    const result = await createDiskEntry(Uri.file(path) as never, schema, maxLines);

    expect(result).toBeNull();
    expect(buildSpy).not.toHaveBeenCalled();
  });
});
