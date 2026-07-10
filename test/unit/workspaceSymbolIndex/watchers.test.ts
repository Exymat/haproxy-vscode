import { isUriExcludedFromWorkspaceSymbols } from "../../../src/symbolIndex";
import { Uri } from "../../helpers/vscode";
import { defaultWorkspaceSymbolSettings } from "./helpers";

describe("workspace symbol watcher helpers", () => {
  const repoFolder = {
    uri: Uri.file("file:///repo"),
    name: "repo",
    index: 0,
  };

  it("honors exclude globs relative to a workspace folder", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["**/node_modules/**", "**/vendor/**"],
      debounceMs: 750,
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/node_modules/pkg/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/haproxy.d/frontends/web.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("supports the current default exclude patterns", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/out/**", "**/vendor/**"],
    });

    for (const path of [
      "file:///repo/.git/config",
      "file:///repo/node_modules/pkg/haproxy.cfg",
      "file:///repo/service/dist/haproxy.cfg",
      "file:///repo/service/out/haproxy.cfg",
      "file:///repo/vendor/pkg/haproxy.cfg",
    ]) {
      expect(
        isUriExcludedFromWorkspaceSymbols(Uri.file(path) as never, settings, repoFolder as never),
      ).toBe(true);
    }
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/haproxy.d/frontends/web.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("supports brace patterns anywhere in exclude globs", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["**/{vendor,cache}/**", "{tmp,logs}/**", "**/{dist,out}/*.cfg"],
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/service/cache/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/tmp/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/service/out/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/service/run/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("supports **, *, ?, and slash normalization", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["configs\\**\\env?\\haproxy-*.cfg"],
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/configs/prod/env1/haproxy-main.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/configs/prod/env10/haproxy-main.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/configs/prod/env1/nested/haproxy-main.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("supports bracket ranges in exclude globs", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["cache[0-9]/**"],
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache0/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache9/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cachex/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache10/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("supports negated bracket ranges in exclude globs", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["cache[!0-9]/**"],
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cachex/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache-/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache1/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("treats invalid bracket globs as literal text", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["cache[z-a]/**", "tmp[]/**", "literal[/**"],
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cache[z-a]/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/tmp[]/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/literal[/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/cacheq/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("matches Windows-style paths case-insensitively", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["**/vendor/**"],
    });
    const folder = {
      uri: Uri.file("C:\\Repo"),
      name: "repo",
      index: 0,
    };

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("C:\\repo\\Vendor\\haproxy.cfg") as never,
        settings,
        folder as never,
      ),
    ).toBe(true);
  });

  it("keeps folder-relative patterns anchored to the RelativePattern base", () => {
    const settings = defaultWorkspaceSymbolSettings({
      exclude: ["vendor/**", "*.cfg"],
    });

    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/vendor/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/service/vendor/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(true);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/service/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///outside/vendor/haproxy.cfg") as never,
        settings,
        repoFolder as never,
      ),
    ).toBe(false);
  });

  it("returns empty exclude pattern settings as not excluded", () => {
    expect(
      isUriExcludedFromWorkspaceSymbols(
        Uri.file("file:///repo/vendor/x.cfg") as never,
        defaultWorkspaceSymbolSettings({ debounceMs: 750 }),
        { uri: Uri.file("file:///repo"), name: "repo", index: 0 } as never,
      ),
    ).toBe(false);
  });
});
