import { isUriExcludedFromWorkspaceSymbols } from "../../../src/symbolIndex";
import { Uri } from "../../__mocks__/vscode";

describe("workspace symbol watcher helpers", () => {
  it("honors exclude globs relative to a workspace folder", () => {
    const settings = {
      enabled: true,
      include: ["**/*.cfg"],
      exclude: ["**/node_modules/**", "**/vendor/**"],
      maxFiles: 1000,
      maxTotalLines: 100000,
      debounceMs: 750,
    };
    const folder = {
      uri: Uri.file("file:///repo"),
      name: "repo",
      index: 0,
    };

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/node_modules/pkg/haproxy.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/haproxy.d/frontends/web.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(false);
  });

  it("returns empty exclude pattern settings as not excluded", () => {
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/vendor/x.cfg") as never,
        {
          enabled: true,
          include: ["**/*.cfg"],
          exclude: [],
          maxFiles: 1000,
          maxTotalLines: 100000,
          debounceMs: 750,
        },
        { uri: Uri.file("file:///repo"), name: "repo", index: 0 } as never,
      ),
    ).toBe(false);
  });
});
