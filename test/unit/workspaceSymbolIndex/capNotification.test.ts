import {
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  hasCappedWorkspaceFolders,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import { commands, setMockWorkspaceFile, window } from "../../helpers/vscode";

import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  schema,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("workspace symbol cap notification", () => {
  setupWorkspaceSymbolIndexTests();

  it("warns once when a folder transitions to a capped index", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");

    await buildWorkspace(1000, 2);

    expect(getWorkspaceSymbolIndex()).toBeNull();
    expect(hasCappedWorkspaceFolders()).toBe(true);
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("cross-file navigation"),
      "Open Settings",
    );

    setMockWorkspaceFile("file:///c.cfg", "backend c");
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({
        maxTotalLines: 2,
      }),
      4000,
      { scope: "full" },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it("opens workspace symbol settings when the warning action is chosen", async () => {
    window.showWarningMessage.mockResolvedValueOnce("Open Settings");
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");

    await buildWorkspace(1000, 2);
    await Promise.resolve();

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "@id:haproxy.workspaceSymbols.maxFiles",
    );
  });

  it("warns again after the workspace index is cleared", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");

    await buildWorkspace(1000, 2);
    clearWorkspaceSymbolIndex();

    await buildWorkspace(1000, 2);

    expect(window.showWarningMessage).toHaveBeenCalledTimes(2);
  });
});
