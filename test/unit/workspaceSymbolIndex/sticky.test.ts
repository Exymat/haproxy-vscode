import {
  findWorkspaceDefinitions,
  getWorkspaceSymbolIndex,
  resolveWorkspaceRebuildScopeOnOpen,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
} from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";

import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "./helpers";

describe("workspace sticky folder indexing", () => {
  setupWorkspaceSymbolIndexTests();

  it("keeps indexed folders warm after their HAProxy tabs are closed", async () => {
    setMockWorkspaceFolders([
      workspaceFolder("file:///git_repo_1"),
      workspaceFolder("file:///git_repo_2"),
    ]);
    setMockWorkspaceFile(
      "file:///git_repo_1/haproxy.d/frontends/FE_WWW.cfg",
      "frontend fe_www\n    use_backend be_www",
    );
    setMockWorkspaceFile("file:///git_repo_1/haproxy.d/backends/BE_WWW.cfg", "backend be_www");
    setMockWorkspaceFile(
      "file:///git_repo_2/haproxy.d/frontends/FE_API.cfg",
      "frontend fe_api\n    use_backend be_api",
    );
    setMockWorkspaceFile("file:///git_repo_2/haproxy.d/backends/BE_API.cfg", "backend be_api");

    const repo1Frontend = createDocument(
      "frontend fe_www\n    use_backend be_www",
      "file:///git_repo_1/haproxy.d/frontends/FE_WWW.cfg",
    );
    mockTextDocuments.push(repo1Frontend as never);
    await buildWorkspace(1000, 100000, ["**/haproxy.d/**/*.cfg"]);

    mockTextDocuments.length = 0;
    const repo2Frontend = createDocument(
      "frontend fe_api\n    use_backend be_api",
      "file:///git_repo_2/haproxy.d/frontends/FE_API.cfg",
    );
    mockTextDocuments.push(repo2Frontend as never);
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      defaultWorkspaceSymbolSettings({
        include: ["**/haproxy.d/**/*.cfg"],
      }),
      4000,
      { scope: "full", document: repo2Frontend },
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const repo1Index = expectWorkspaceIndex(getWorkspaceSymbolIndex(repo1Frontend));
    expect(findWorkspaceDefinitions(repo1Index, "proxy-section", "be_www", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(repo1Index, "proxy-section", "be_api", null)).toHaveLength(0);
  });

  it("skips workspace rebuild when reopening unchanged content", async () => {
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    setMockWorkspaceFile("file:///backends/api.cfg", "backend api");
    const frontend = createDocument(
      "frontend web\n    use_backend api",
      "file:///frontends/web.cfg",
    );
    mockTextDocuments.push(frontend as never);
    await buildWorkspace();

    mockTextDocuments.length = 0;
    expect(resolveWorkspaceRebuildScopeOnOpen(frontend)).toBe("none");

    const listener = vi.fn();
    const { setWorkspaceSymbolIndexChangeListener } = await import("../../../src/symbolIndex");
    setWorkspaceSymbolIndexChangeListener(listener);

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "none",
      document: frontend,
    });
    await vi.runAllTimersAsync();
    expect(listener).not.toHaveBeenCalled();
    setWorkspaceSymbolIndexChangeListener(undefined);
  });
});
