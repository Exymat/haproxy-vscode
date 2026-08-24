import { computeDiagnostics } from "../../../src/diagnostics";
import { provideDefinition, provideReferences } from "../../../src/navigation";
import {
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
} from "../../../src/symbolIndex";
import {
  mockTextDocuments,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
} from "../../helpers/vscode";
import { createDocument, updateDocument } from "../../helpers/document";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";

import {
  buildWorkspace,
  defaultWorkspaceSymbolSettings,
  expectWorkspaceIndex,
  pos,
  schema,
  setupWorkspaceSymbolIndexTests,
  workspaceFolder,
} from "./helpers";

const symbolDiagnosticOptions = {
  unusedSymbols: true,
  missingReferences: true,
  maxLines: 4000,
} as const;

describe("workspace symbol index diagnostics", () => {
  setupWorkspaceSymbolIndexTests();

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
    expect(
      diagnostics.find((diag) => formatDiagnosticCode(diag.code) === "missing-reference")?.message,
    ).toContain("not defined in this workspace");
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

  it("resolves a new defaults profile across split files after both incremental updates", async () => {
    const defaultsUri = "file:///defaults.cfg";
    const frontendUri = "file:///frontends/web.cfg";
    const initialDefaults = ["defaults http", "    mode http"].join("\n");
    const initialFrontend = ["frontend web", "    bind :80"].join("\n");
    const updatedDefaults = [
      "defaults http",
      "    mode http",
      "defaults api",
      "    mode http",
    ].join("\n");
    const updatedFrontend = ["frontend web from api", "    bind :80"].join("\n");

    setMockWorkspaceFile(defaultsUri, initialDefaults);
    setMockWorkspaceFile(frontendUri, initialFrontend);
    const defaultsDoc = createDocument(initialDefaults, defaultsUri);
    const frontendDoc = createDocument(initialFrontend, frontendUri);
    mockTextDocuments.push(defaultsDoc as never, frontendDoc as never);

    await buildWorkspace();
    computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions);
    computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);

    updateDocument(defaultsDoc, updatedDefaults);
    updateDocument(frontendDoc, updatedFrontend);
    setMockWorkspaceFile(defaultsUri, updatedDefaults);
    setMockWorkspaceFile(frontendUri, updatedFrontend);

    setWorkspaceSymbolIndexChangeListener((event) => {
      if (event.document) {
        computeDiagnostics(event.document, schema, symbolDiagnosticOptions);
      }
      computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions);
      computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);
    });

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: defaultsDoc,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: frontendDoc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex(defaultsDoc));
    expect(findWorkspaceDefinitions(workspaceIndex, "defaults-profile", "api", null)).toHaveLength(
      1,
    );
    expect(findWorkspaceReferences(workspaceIndex, "defaults-profile", "api", null)).toHaveLength(
      1,
    );

    const defaultsDiags = computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions);
    const frontendDiags = computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);

    expect(
      defaultsDiags.filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "unused-defaults-profile" &&
          diag.message.includes("api"),
      ),
    ).toHaveLength(0);
    expect(
      frontendDiags.filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "missing-reference" && diag.message.includes("api"),
      ),
    ).toHaveLength(0);
  });

  it("does not keep missing-reference diagnostics when the frontend is indexed before the new defaults profile", async () => {
    const defaultsUri = "file:///defaults.cfg";
    const frontendUri = "file:///frontends/web.cfg";
    const initialDefaults = ["defaults http", "    mode http"].join("\n");
    const initialFrontend = ["frontend web", "    bind :80"].join("\n");
    const updatedDefaults = [
      "defaults http",
      "    mode http",
      "defaults api",
      "    mode http",
    ].join("\n");
    const updatedFrontend = ["frontend web from api", "    bind :80"].join("\n");

    setMockWorkspaceFile(defaultsUri, initialDefaults);
    setMockWorkspaceFile(frontendUri, initialFrontend);
    const defaultsDoc = createDocument(initialDefaults, defaultsUri);
    const frontendDoc = createDocument(initialFrontend, frontendUri);
    mockTextDocuments.push(defaultsDoc as never, frontendDoc as never);

    await buildWorkspace();
    computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions);
    computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);

    updateDocument(frontendDoc, updatedFrontend);
    updateDocument(defaultsDoc, updatedDefaults);
    setMockWorkspaceFile(frontendUri, updatedFrontend);
    setMockWorkspaceFile(defaultsUri, updatedDefaults);

    setWorkspaceSymbolIndexChangeListener((event) => {
      if (event.document) {
        computeDiagnostics(event.document, schema, symbolDiagnosticOptions);
      }
      computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions);
      computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);
    });

    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: frontendDoc,
    });
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: defaultsDoc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const frontendDiags = computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);
    const defaultsDiags = computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions);

    expect(
      frontendDiags.filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "missing-reference" && diag.message.includes("api"),
      ),
    ).toHaveLength(0);
    expect(
      defaultsDiags.filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "unused-defaults-profile" &&
          diag.message.includes("api"),
      ),
    ).toHaveLength(0);
  });

  it("picks up a new defaults profile in nested haproxy.d frontends after only defaults.cfg changes", async () => {
    const include = ["**/haproxy.d/**/*.cfg", "**/haproxy.d/*.cfg"];
    const defaultsUri = "file:///test_dir/haproxy.d/defaults.cfg";
    const frontendUri = "file:///test_dir/haproxy.d/frontends/fe_1.cfg";
    const backendUri = "file:///test_dir/haproxy.d/backends/be_1.cfg";
    const initialDefaults = ["defaults http", "    mode http"].join("\n");
    const frontendContent = [
      "frontend fe_1 from api",
      "    bind :80",
      "    default_backend be_1",
    ].join("\n");
    const backendContent = ["backend be_1", "    server s1 127.0.0.1:80"].join("\n");
    const updatedDefaults = [
      "defaults http",
      "    mode http",
      "defaults api",
      "    mode http",
    ].join("\n");

    setMockWorkspaceFolders([workspaceFolder("file:///test_dir")]);
    setMockWorkspaceFile(defaultsUri, initialDefaults);
    setMockWorkspaceFile(frontendUri, frontendContent);
    setMockWorkspaceFile(backendUri, backendContent);
    const defaultsDoc = createDocument(initialDefaults, defaultsUri);
    const frontendDoc = createDocument(frontendContent, frontendUri);
    const backendDoc = createDocument(backendContent, backendUri);
    mockTextDocuments.push(defaultsDoc as never, frontendDoc as never, backendDoc as never);

    await buildWorkspace(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, include);

    const before = computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);
    expect(
      before.filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "missing-reference" && diag.message.includes("api"),
      ),
    ).toHaveLength(1);

    updateDocument(defaultsDoc, updatedDefaults);
    setMockWorkspaceFile(defaultsUri, updatedDefaults);
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings({ include }), 4000, {
      scope: "incremental",
      document: defaultsDoc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex(frontendDoc));
    expect(workspaceIndex.documents.has(frontendUri)).toBe(true);
    expect(workspaceIndex.documents.has(backendUri)).toBe(true);
    expect(findWorkspaceDefinitions(workspaceIndex, "defaults-profile", "api", null)).toHaveLength(
      1,
    );

    const after = computeDiagnostics(frontendDoc, schema, symbolDiagnosticOptions);
    expect(
      after.filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "missing-reference" && diag.message.includes("api"),
      ),
    ).toHaveLength(0);
    expect(
      computeDiagnostics(defaultsDoc, schema, symbolDiagnosticOptions).filter(
        (diag) =>
          formatDiagnosticCode(diag.code) === "unused-defaults-profile" &&
          diag.message.includes("api"),
      ),
    ).toHaveLength(0);
  });
});
