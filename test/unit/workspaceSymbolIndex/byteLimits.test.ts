import { createDiskEntry } from "../../../src/symbolIndex/workspaceDocuments";
import {
  findWorkspaceDefinitions,
  getWorkspaceSymbolIndex,
  hasCappedWorkspaceFolders,
  isDocumentWorkspaceIndexCapped,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFileStat,
  Uri,
  workspace,
} from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";

import {
  buildWorkspace,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("workspace symbol byte limits", () => {
  setupWorkspaceSymbolIndexTests();

  it("indexes a one-line file that exceeds the old default byte ceiling", async () => {
    const maxLines = 4000;
    const path = "file:///huge-one-line.cfg";
    const oversizedLine = "backend api " + "x".repeat(1_500_000);
    setMockWorkspaceFile(path, oversizedLine);
    setMockWorkspaceFileStat(path, Date.now(), oversizedLine.length);

    const readFileSpy = vi.spyOn(workspace.fs, "readFile");
    const result = await createDiskEntry(Uri.file(path) as never, schema, maxLines);

    expect(result).not.toBeNull();
    expect(readFileSpy).toHaveBeenCalled();
  });

  it("caps the workspace by total bytes when many one-line files stay under maxTotalLines", async () => {
    const fileBytes = 500_000;
    const padding = "x".repeat(fileBytes - "backend a".length);
    setMockWorkspaceFile("file:///a.cfg", `backend a${padding}`);
    setMockWorkspaceFile("file:///b.cfg", `backend b${padding}`);
    setMockWorkspaceFile("file:///c.cfg", `backend c${padding}`);

    await buildWorkspace(1000, 100000, ["**/*.cfg"], {
      maxTotalBytes: 1_000_000,
      maxLineBytes: 1_000_000,
    });

    expect(getWorkspaceSymbolIndex()).toBeNull();
    expect(hasCappedWorkspaceFolders()).toBe(true);
  });

  it("marks the folder capped when total bytes are exceeded", async () => {
    const fileBytes = 600_000;
    const padding = "x".repeat(fileBytes - "backend a".length);
    setMockWorkspaceFile("file:///a.cfg", `backend a${padding}`);
    setMockWorkspaceFile("file:///b.cfg", `backend b${padding}`);

    await buildWorkspace(1000, 100000, ["**/*.cfg"], {
      maxTotalBytes: 1_000_000,
      maxLineBytes: 1_000_000,
    });

    const openDoc = createDocument("backend open", "file:///open.cfg");
    mockTextDocuments.push(openDoc as never);

    expect(isDocumentWorkspaceIndexCapped(openDoc)).toBe(true);
  });

  it("still indexes ordinary small split HAProxy configs across files", async () => {
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    setMockWorkspaceFile("file:///backends/api.cfg", "backend api\n    server s1 127.0.0.1:80");

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api", null)).toHaveLength(1);
  });

  it("skips files with a line longer than maxLineBytes", async () => {
    const longLine = "backend api " + "x".repeat(10_000);
    setMockWorkspaceFile("file:///long-line.cfg", longLine);

    const result = await createDiskEntry(
      Uri.file("file:///long-line.cfg") as never,
      schema,
      4000,
      undefined,
      {
        maxFileBytes: 2_000_000,
        maxLineBytes: 8192,
      },
    );

    expect(result).toBeNull();
  });
});
