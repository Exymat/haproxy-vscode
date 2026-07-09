import { computeDiagnostics } from "../../../src/diagnostics";
import {
  buildWorkspaceSymbolIndexFromOpenDocuments,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getWorkspaceSymbolIndex,
  refreshWorkspaceSymbolIndexNow,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  workspaceUriKey,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
} from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";

import {
  buildWorkspace,
  expectWorkspaceIndex,
  schema,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "./helpers";

describe("workspace symbol index build", () => {
  setupWorkspaceSymbolIndexTests();

  it("preserves non-file URI keys", () => {
    const uri = { scheme: "untitled", toString: () => "untitled:HAProxy.cfg" };
    expect(workspaceUriKey(uri as never)).toBe("untitled:HAProxy.cfg");
  });

  it("normalizes Windows file URI keys case-insensitively", () => {
    const uri = {
      scheme: "file",
      fsPath: "C:\\Repo\\haproxy.d\\frontends\\FE_WWW.cfg",
      toString: () => "file:///C%3A/Repo/haproxy.d/frontends/FE_WWW.cfg",
    };
    expect(workspaceUriKey(uri as never)).toBe("file:///c%3a/repo/haproxy.d/frontends/fe_www.cfg");
  });

  it("aggregates backend definitions and references across files", async () => {
    setMockWorkspaceFile("file:///frontends/web.cfg", "frontend web\n    use_backend api");
    setMockWorkspaceFile("file:///backends/api.cfg", "backend api\n    server s1 127.0.0.1:80");

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api", null)).toHaveLength(1);
    expect(findWorkspaceReferences(workspaceIndex, "proxy-section", "api", null)).toHaveLength(1);
  });

  it("indexes split haproxy.d layouts with configured include globs", async () => {
    const frontendContent = [
      "frontend fe_www",
      "    bind 127.0.0.1:80",
      "    acl url_www path_beg www",
      "    use_backend be_www if url_www",
    ].join("\n");
    const backendContent = [
      "backend be_www",
      "    server web1 192.168.1.100:80",
      "    server web2 192.168.1.101:80",
    ].join("\n");
    setMockWorkspaceFile("file:///repo/haproxy.d/default.cfg", "defaults default\n    mode http");
    setMockWorkspaceFile("file:///repo/haproxy.d/global.cfg", "global\n    daemon");
    setMockWorkspaceFile("file:///repo/haproxy.d/frontends/FE_WWW.cfg", frontendContent);
    setMockWorkspaceFile("file:///repo/haproxy.d/backends/BE_WWW.cfg", backendContent);

    const frontend = createDocument(frontendContent, "file:///repo/haproxy.d/frontends/FE_WWW.cfg");
    mockTextDocuments.push(frontend as never);

    const workspaceIndex = expectWorkspaceIndex(
      await buildWorkspace(300, 100000, [
        "**/haproxy.d/**/*.cfg",
        "**/haproxy.d/*.cfg",
        "**/*.cfg",
      ]),
    );

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "be_www", null)).toHaveLength(
      1,
    );
    const diagnostics = computeDiagnostics(frontend, schema, {
      unusedSymbols: false,
      missingReferences: true,
      maxLines: 4000,
    });
    expect(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference"),
    ).toHaveLength(0);
  });

  it("does not index open files that are not matched by workspace globs", async () => {
    const frontendContent = "frontend fe_www\n    use_backend be_www";
    const frontend = createDocument(frontendContent, "file:///external/haproxy.d/frontends/FE.cfg");
    mockTextDocuments.push(frontend as never);

    const workspaceIndex = expectWorkspaceIndex(
      await buildWorkspace(1000, 100000, ["**/does-not-match/**/*.cfg"]),
    );

    expect(workspaceIndex.documents.size).toBe(0);
    const diagnostics = computeDiagnostics(frontend, schema, {
      unusedSymbols: false,
      missingReferences: true,
      maxLines: 4000,
    });
    expect(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference"),
    ).toHaveLength(1);
  });

  it("indexes and caps each VS Code workspace folder independently", async () => {
    setMockWorkspaceFolders([
      workspaceFolder("file:///git_repo_1"),
      workspaceFolder("file:///git_repo_2"),
      workspaceFolder("file:///git_repo_3"),
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
    setMockWorkspaceFile("file:///git_repo_2/haproxy.d/default.cfg", "defaults default");
    setMockWorkspaceFile("file:///git_repo_3/haproxy.d/backends/BE_OTHER.cfg", "backend be_other");

    const repo1Frontend = createDocument(
      "frontend fe_www\n    use_backend be_www",
      "file:///git_repo_1/haproxy.d/frontends/FE_WWW.cfg",
    );
    const plaintext = createDocument("not haproxy", "file:///git_repo_3/haproxy.d/notes.cfg");
    Object.defineProperty(plaintext, "languageId", { value: "plaintext" });
    mockTextDocuments.push(repo1Frontend as never, plaintext as never);

    await buildWorkspace(2, 100000, ["**/haproxy.d/**/*.cfg", "**/haproxy.d/*.cfg"]);
    const repo1Index = expectWorkspaceIndex(getWorkspaceSymbolIndex(repo1Frontend));
    expect(repo1Index.documents.size).toBe(2);
    expect(findWorkspaceDefinitions(repo1Index, "proxy-section", "be_www", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(repo1Index, "proxy-section", "be_api", null)).toHaveLength(0);

    const repo2Frontend = createDocument(
      "frontend fe_api\n    use_backend be_api",
      "file:///git_repo_2/haproxy.d/frontends/FE_API.cfg",
    );
    mockTextDocuments.push(repo2Frontend as never);

    await buildWorkspace(2, 100000, ["**/haproxy.d/**/*.cfg", "**/haproxy.d/*.cfg"]);
    expect(getWorkspaceSymbolIndex(repo2Frontend)).toBeNull();
    expect(findWorkspaceDefinitions(repo1Index, "proxy-section", "be_www", null)).toHaveLength(1);
  });

  it("aggregates defaults and global referenced sections across files", async () => {
    setMockWorkspaceFile("file:///defaults.cfg", "defaults base\n    mode http");
    setMockWorkspaceFile("file:///cache.cfg", "cache main_cache\n    total-max-size 4");
    setMockWorkspaceFile("file:///auth.cfg", "userlist stats\n    user admin insecure-password x");
    setMockWorkspaceFile("file:///dns.cfg", "resolvers dns-main\n    nameserver ns1 127.0.0.1:53");
    setMockWorkspaceFile("file:///peers.cfg", "peers cluster\n    peer p1 127.0.0.1:10000");
    setMockWorkspaceFile(
      "file:///frontends/web.cfg",
      [
        "frontend web from base",
        "    http-request cache-use main_cache",
        "    acl AUTH http_auth(stats)",
        "backend api",
        "    server s1 host.local:80 resolvers dns-main",
        "    stick-table type ip size 1 peers cluster",
      ].join("\n"),
    );

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());

    expect(findWorkspaceReferences(workspaceIndex, "defaults-profile", "base", null)).toHaveLength(
      1,
    );
    expect(findWorkspaceReferences(workspaceIndex, "cache", "main_cache", null)).toHaveLength(1);
    expect(findWorkspaceReferences(workspaceIndex, "userlist", "stats", null)).toHaveLength(1);
    expect(findWorkspaceReferences(workspaceIndex, "resolvers", "dns-main", null)).toHaveLength(1);
    expect(findWorkspaceReferences(workspaceIndex, "peers", "cluster", null)).toHaveLength(1);
  });

  it("keeps duplicate definitions as separate targets", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend api");
    setMockWorkspaceFile("file:///b.cfg", "backend api");

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api", null)).toHaveLength(2);
  });

  it("uses unsaved open document content instead of disk content", async () => {
    setMockWorkspaceFile("file:///backends/api.cfg", "backend old");
    mockTextDocuments.push(createDocument("backend api", "file:///backends/api.cfg") as never);

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace());

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "old", null)).toHaveLength(0);
  });

  it("falls back to local behavior when workspace caps are exceeded", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");
    setMockWorkspaceFile("file:///b.cfg", "backend b");

    expect(await buildWorkspace(1)).toBeNull();
  });

  it("does not cap the workspace graph because of foreign .cfg files", async () => {
    setMockWorkspaceFile("file:///nginx-a.cfg", "server { listen 80; }");
    setMockWorkspaceFile("file:///nginx-b.cfg", "upstream app { server 127.0.0.1; }");
    setMockWorkspaceFile("file:///consul.cfg", 'services { name = "api" }');
    setMockWorkspaceFile("file:///api.cfg", "backend api");

    const workspaceIndex = expectWorkspaceIndex(await buildWorkspace(1));

    expect(workspaceIndex.capped).toBe(false);
    expect(workspaceIndex.documents.size).toBe(1);
    expect(workspaceIndex.documents.has("file:///api.cfg")).toBe(true);
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api", null)).toHaveLength(1);
  });

  it("builds a workspace graph from open documents and skips non-HAProxy or oversized documents", () => {
    const haproxy = createDocument("backend api", "file:///api.cfg");
    const plain = {
      ...createDocument("backend ignored", "file:///ignored.cfg"),
      languageId: "text",
    };
    const foreignCfg = createDocument("server { listen 80; }", "file:///nginx.cfg");
    const oversized = createDocument(
      "backend too_big\n    server s1 127.0.0.1:80",
      "file:///big.cfg",
    );

    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments(
      [haproxy, plain, foreignCfg, oversized],
      schema,
      1,
    );

    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "api", null)).toHaveLength(1);
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "ignored", null)).toHaveLength(
      0,
    );
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "too_big", null)).toHaveLength(
      0,
    );
    expect(workspaceIndex.documents.has("file:///nginx.cfg")).toBe(false);
  });

  it("disables workspace indexing when configured off", async () => {
    const listener = vi.fn();
    setWorkspaceSymbolIndexChangeListener(listener);
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      {
        enabled: false,
        include: ["**/*.cfg"],
        exclude: [],
        maxFiles: 300,
        maxTotalLines: 100000,
        debounceMs: 100,
      },
      4000,
    );

    await vi.runAllTimersAsync();

    expect(getWorkspaceSymbolIndex()).toBeNull();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ scope: "full" }));
  });

  it("caps workspace indexing when total lines are exceeded", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a\n    server s1 127.0.0.1:80");
    setMockWorkspaceFile("file:///b.cfg", "backend b\n    server s1 127.0.0.1:80");

    expect(await buildWorkspace(300, 2)).toBeNull();
  });

  it("skips oversized disk files without disabling the workspace graph", async () => {
    setMockWorkspaceFile("file:///big.cfg", "backend big\n    server s1 127.0.0.1:80");
    scheduleWorkspaceSymbolIndexRebuild(
      schema,
      {
        enabled: true,
        include: ["**/*.cfg"],
        exclude: [],
        maxFiles: 300,
        maxTotalLines: 100000,
        debounceMs: 100,
      },
      1,
    );

    await vi.runAllTimersAsync();

    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(workspaceIndex.documents.size).toBe(0);
  });

  it("refreshes the active workspace symbol settings on demand", async () => {
    setMockWorkspaceFile("file:///a.cfg", "backend a");

    refreshWorkspaceSymbolIndexNow();
    expect(getWorkspaceSymbolIndex()).toBeNull();

    await buildWorkspace();
    setMockWorkspaceFile("file:///b.cfg", "backend b");
    refreshWorkspaceSymbolIndexNow();
    await vi.runAllTimersAsync();

    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex());
    expect(findWorkspaceDefinitions(workspaceIndex, "proxy-section", "b", null)).toHaveLength(1);
  });
});
