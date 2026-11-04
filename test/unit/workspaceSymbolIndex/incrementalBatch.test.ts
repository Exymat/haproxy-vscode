import { Uri, workspace } from "vscode";

import {
  findWorkspaceDefinitions,
  getWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import * as workspaceDocuments from "../../../src/symbolIndex/workspaceDocuments";
import { createDocument } from "../../helpers/document";
import { setMockWorkspaceFile } from "../../helpers/vscode";
import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("incremental folder updates", () => {
  setupWorkspaceSymbolIndexTests();
  afterEach(() => vi.restoreAllMocks());

  const paths = ["file:///first.cfg", "file:///second.cfg"];

  beforeEach(async () => {
    for (const path of paths) {
      setMockWorkspaceFile(path, "backend original");
    }
    await buildWorkspace();
  });

  it("publishes multiple edited documents with one aggregation", async () => {
    const aggregate = vi.spyOn(workspaceDocuments, "aggregateDocuments");
    for (const [i, path] of paths.entries()) {
      const document = createDocument(`backend edited_${i}`, path);
      scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
        scope: "incremental",
        document,
      });
    }
    await vi.runAllTimersAsync();

    const index = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(index.totalLines).toBe(2);
    expect(index.totalBytes).toBe(2 * "backend edited_0".length);
    expect(findWorkspaceDefinitions(index, "proxy-section", "original", null)).toHaveLength(0);
    expect(findWorkspaceDefinitions(index, "proxy-section", "edited_0", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(index, "proxy-section", "edited_1", null)).toHaveLength(1);
  });

  it("refreshes a changed disk entry without inspecting its neighbors", async () => {
    const stat = vi.spyOn(workspace.fs, "stat");
    const read = vi.spyOn(workspace.fs, "readFile");
    const uri = Uri.file(paths[0]);
    setMockWorkspaceFile(paths[0], "backend updated_from_disk");
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      uri,
    });
    await vi.runAllTimersAsync();

    expect(stat).toHaveBeenCalledExactlyOnceWith(uri);
    expect(read).toHaveBeenCalledExactlyOnceWith(uri);
    const index = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(
      findWorkspaceDefinitions(index, "proxy-section", "updated_from_disk", null),
    ).toHaveLength(1);
    expect(findWorkspaceDefinitions(index, "proxy-section", "original", null)).toHaveLength(1);
  });
});
