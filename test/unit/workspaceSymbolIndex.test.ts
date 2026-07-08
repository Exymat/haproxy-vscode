import { computeDiagnostics } from "../../src/diagnostics";
import { duplicateSectionDiagnostics } from "../../src/duplicateSymbolDiagnostics";
import { provideDefinition, provideReferences } from "../../src/navigation";
import {
  buildWorkspaceSymbolIndexFromOpenDocuments,
  clearWorkspaceSymbolIndex,
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getWorkspaceSymbolIndex,
  refreshWorkspaceSymbolIndexNow,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  workspaceUriKey,
  type WorkspaceSymbolIndex,
} from "../../src/symbolIndex";
import { mockTextDocuments, resetVscodeMock, setMockWorkspaceFile } from "../__mocks__/vscode";
import { createDocument } from "../helpers/document";
import { formatDiagnosticCode } from "../helpers/diagnosticFormat";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");

function pos(line: number, character: number) {
  return { line, character } as never;
}

async function buildWorkspace(maxFiles = 300, maxTotalLines = 100000, include = ["**/*.cfg"]) {
  scheduleWorkspaceSymbolIndexRebuild(
    schema,
    {
      enabled: true,
      include,
      exclude: [],
      maxFiles,
      maxTotalLines,
      debounceMs: 100,
    },
    4000,
  );
  await vi.runAllTimersAsync();
  await Promise.resolve();
  return getWorkspaceSymbolIndex();
}

function expectWorkspaceIndex(index: WorkspaceSymbolIndex | null): WorkspaceSymbolIndex {
  expect(index).not.toBeNull();
  if (index === null) {
    throw new Error("expected workspace index");
  }
  return index;
}

function expectWorkspaceDocumentSymbols(workspaceIndex: WorkspaceSymbolIndex, uriKey: string) {
  const symbols = workspaceIndex.documents.get(uriKey);
  expect(symbols).toBeDefined();
  if (symbols === undefined) {
    throw new Error("expected workspace document symbols");
  }
  return symbols;
}

describe("workspace symbol index", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetVscodeMock();
    clearWorkspaceSymbolIndex();
  });

  afterEach(() => {
    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("preserves non-file URI keys", () => {
    const uri = { scheme: "untitled", toString: () => "untitled:HAProxy.cfg" };
    expect(workspaceUriKey(uri as never)).toBe("untitled:HAProxy.cfg");
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

    const frontend = createDocument(frontendContent, "file:///repo/haproxy.d/frontends/fe_www.cfg");
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

  it("reports duplicate sections across workspace files", async () => {
    const first = createDocument("backend api", "file:///backends/api-a.cfg");
    const second = createDocument("backend api", "file:///backends/api-b.cfg");
    setMockWorkspaceFile("file:///backends/api-a.cfg", first.getText());
    setMockWorkspaceFile("file:///backends/api-b.cfg", second.getText());
    mockTextDocuments.push(first as never, second as never);

    await buildWorkspace();

    const firstDiags = computeDiagnostics(first, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxLines: 4000,
    });
    const secondDiags = computeDiagnostics(second, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxLines: 4000,
    });

    expect(
      firstDiags.filter((d) => formatDiagnosticCode(d.code) === "duplicate-section"),
    ).toHaveLength(1);
    expect(
      secondDiags.filter((d) => formatDiagnosticCode(d.code) === "duplicate-section"),
    ).toHaveLength(1);
  });

  it("labels duplicate section kinds and same-file duplicates", () => {
    const content = [
      "defaults base",
      "defaults base",
      "cache shared",
      "cache shared",
      "userlist auth",
      "userlist auth",
      "resolvers dns",
      "resolvers dns",
      "peers cluster",
      "peers cluster",
    ].join("\n");
    const document = createDocument(content, "file:///duplicates.cfg");
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments([document], schema, 4000);

    const diagnostics = duplicateSectionDiagnostics(
      document,
      expectWorkspaceDocumentSymbols(workspaceIndex, document.uri.toString()).parsed,
      workspaceIndex,
    );

    expect(diagnostics.map((diag) => diag.message)).toEqual(
      expect.arrayContaining([
        "Duplicate defaults profile 'base' is also defined in this file",
        "Duplicate cache section 'shared' is also defined in this file",
        "Duplicate userlist section 'auth' is also defined in this file",
        "Duplicate resolvers section 'dns' is also defined in this file",
        "Duplicate peers section 'cluster' is also defined in this file",
      ]),
    );
  });

  it("summarizes duplicate sections across multiple other files", () => {
    const first = createDocument("backend api", "file:///a.cfg");
    const second = createDocument("backend api", "file:///b.cfg");
    const third = createDocument("backend api", "file:///c.cfg");
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments(
      [first, second, third],
      schema,
      4000,
    );

    const diagnostics = duplicateSectionDiagnostics(
      first,
      expectWorkspaceDocumentSymbols(workspaceIndex, first.uri.toString()).parsed,
      workspaceIndex,
    );

    expect(diagnostics[0]?.message).toBe(
      "Duplicate backend section 'api' is also defined in 2 other workspace files",
    );
  });

  it("deduplicates repeated duplicate definition sites defensively", () => {
    const document = createDocument("cache shared", "file:///cache.cfg");
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments([document], schema, 4000);
    const site = findWorkspaceDefinitions(workspaceIndex, "cache", "shared", null)[0];
    workspaceIndex.definitions.set("cache:shared", [site, site]);

    const diagnostics = duplicateSectionDiagnostics(
      document,
      expectWorkspaceDocumentSymbols(workspaceIndex, document.uri.toString()).parsed,
      workspaceIndex,
    );

    expect(diagnostics).toHaveLength(1);
  });

  it("does not report workspace duplicate sections when indexing is capped", async () => {
    const first = createDocument("backend api", "file:///backends/api-a.cfg");
    const second = createDocument("backend api", "file:///backends/api-b.cfg");
    setMockWorkspaceFile("file:///backends/api-a.cfg", first.getText());
    setMockWorkspaceFile("file:///backends/api-b.cfg", second.getText());
    mockTextDocuments.push(first as never, second as never);

    await buildWorkspace(1);

    const diags = computeDiagnostics(first, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxLines: 4000,
    });

    expect(diags.filter((d) => formatDiagnosticCode(d.code) === "duplicate-section")).toHaveLength(
      0,
    );
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

  it("builds a workspace graph from open documents and skips non-HAProxy or oversized documents", () => {
    const haproxy = createDocument("backend api", "file:///api.cfg");
    const plain = {
      ...createDocument("backend ignored", "file:///ignored.cfg"),
      languageId: "text",
    };
    const oversized = createDocument(
      "backend too_big\n    server s1 127.0.0.1:80",
      "file:///big.cfg",
    );

    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments(
      [haproxy, plain, oversized],
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
    expect(listener).toHaveBeenCalled();
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

  it("keeps missing-reference diagnostics when the workspace has no definition", async () => {
    const content = "frontend web\n    use_backend missing";
    setMockWorkspaceFile("file:///frontends/web.cfg", content);
    const frontend = createDocument(content, "file:///frontends/web.cfg");
    mockTextDocuments.push(frontend as never);

    await buildWorkspace();

    const diagnostics = computeDiagnostics(frontend, schema, {
      unusedSymbols: false,
      missingReferences: true,
      maxLines: 4000,
    });

    expect(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference"),
    ).toHaveLength(1);
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

  it("suppresses missing and unused diagnostics using workspace references", async () => {
    const frontendContent = "frontend web\n    use_backend api";
    const backendContent = "backend api\n    server s1 127.0.0.1:80";
    setMockWorkspaceFile("file:///frontends/web.cfg", frontendContent);
    setMockWorkspaceFile("file:///backends/api.cfg", backendContent);
    const frontend = createDocument(frontendContent, "file:///frontends/web.cfg");
    const backend = createDocument(backendContent, "file:///backends/api.cfg");
    mockTextDocuments.push(frontend as never, backend as never);

    await buildWorkspace();

    const frontendDiags = computeDiagnostics(frontend, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxLines: 4000,
    });
    const backendDiags = computeDiagnostics(backend, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxLines: 4000,
    });

    expect(frontendDiags.filter((d) => d.code === "missing-reference")).toHaveLength(0);
    expect(
      backendDiags.filter((d) => formatDiagnosticCode(d.code) === "unused-section"),
    ).toHaveLength(0);
  });

  it("still reports local unused symbols with no workspace references", async () => {
    const backend = createDocument(
      "backend api\n    server s1 127.0.0.1:80",
      "file:///backends/api.cfg",
    );
    mockTextDocuments.push(backend as never);

    await buildWorkspace();

    const diags = computeDiagnostics(backend, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxLines: 4000,
    });

    expect(diags.some((d) => formatDiagnosticCode(d.code) === "unused-section")).toBe(true);
  });

  it("provides cross-file definitions and references with target URIs", async () => {
    const frontendContent = "frontend web\n    use_backend api";
    const backendContent = "backend api\n    server s1 127.0.0.1:80";
    setMockWorkspaceFile("file:///frontends/web.cfg", frontendContent);
    setMockWorkspaceFile("file:///backends/api.cfg", backendContent);
    const frontend = createDocument(frontendContent, "file:///frontends/web.cfg");
    const backend = createDocument(backendContent, "file:///backends/api.cfg");
    mockTextDocuments.push(frontend as never, backend as never);

    await buildWorkspace();

    const col = "    use_backend api".indexOf("api");
    const definition = provideDefinition(frontend, pos(1, col), schema, 4000);
    expect(Array.isArray(definition)).toBe(true);
    expect(
      (definition as Array<{ targetUri: { toString: () => string } }>)[0].targetUri.toString(),
    ).toBe("file:///backends/api.cfg");

    const references = provideReferences(
      backend,
      pos(0, "backend api".indexOf("api")),
      { includeDeclaration: true },
      schema,
      4000,
    );
    expect(references.map((location) => location.uri.toString()).sort()).toEqual([
      "file:///backends/api.cfg",
      "file:///frontends/web.cfg",
    ]);
  });

  it("uses workspace navigation for non-section definitions and reference-only lookups", async () => {
    const frontendContent = [
      "frontend web",
      "    acl is_api path_beg /api",
      "    use_backend api if is_api",
    ].join("\n");
    const backendContent = "backend api\n    server s1 127.0.0.1:80";
    setMockWorkspaceFile("file:///frontends/web.cfg", frontendContent);
    setMockWorkspaceFile("file:///backends/api.cfg", backendContent);
    const frontend = createDocument(frontendContent, "file:///frontends/web.cfg");
    const backend = createDocument(backendContent, "file:///backends/api.cfg");
    mockTextDocuments.push(frontend as never, backend as never);

    await buildWorkspace();

    const aclCol = "    use_backend api if is_api".indexOf("is_api");
    const definition = provideDefinition(frontend, pos(2, aclCol), schema, 4000);
    expect(definition).not.toBeNull();
    expect(Array.isArray(definition)).toBe(false);

    const references = provideReferences(
      backend,
      pos(0, "backend api".indexOf("api")),
      { includeDeclaration: false },
      schema,
      4000,
    );
    expect(references.map((location) => location.uri.toString())).toEqual([
      "file:///frontends/web.cfg",
    ]);
  });
});
