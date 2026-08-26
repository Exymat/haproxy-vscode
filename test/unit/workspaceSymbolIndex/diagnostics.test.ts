import { describe, expect, it } from "vitest";

import { computeDiagnostics } from "../../../src/diagnostics";
import { provideDefinition, provideReferences } from "../../../src/navigation";
import {
  findWorkspaceDefinitions,
  findWorkspaceReferences,
  getWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
  setWorkspaceSymbolIndexChangeListener,
  type SymbolKind,
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

interface NamedSectionIncrementalCase {
  label: string;
  kind: SymbolKind;
  name: string;
  unusedCode: string;
  expectMissingBefore: boolean;
  definitionUri: string;
  referenceUri: string;
  initialDefinition: string;
  updatedDefinition: string;
  referenceContent: string;
  referenceLine: number;
  referenceCol: number;
}

const namedSectionIncrementalCases: NamedSectionIncrementalCase[] = [
  {
    label: "backend",
    kind: "proxy-section",
    name: "api",
    unusedCode: "unused-section",
    expectMissingBefore: true,
    definitionUri: "file:///test_dir/haproxy.d/backends/api.cfg",
    referenceUri: "file:///test_dir/haproxy.d/frontends/web.cfg",
    initialDefinition: ["defaults", "    mode http"].join("\n"),
    updatedDefinition: ["backend api", "    server s1 127.0.0.1:80"].join("\n"),
    referenceContent: ["frontend web", "    bind :80", "    use_backend api"].join("\n"),
    referenceLine: 2,
    referenceCol: "    use_backend ".length,
  },
  {
    label: "cache",
    kind: "cache",
    name: "pages",
    unusedCode: "unused-symbol",
    expectMissingBefore: true,
    definitionUri: "file:///test_dir/haproxy.d/cache.cfg",
    referenceUri: "file:///test_dir/haproxy.d/frontends/web.cfg",
    initialDefinition: ["defaults", "    mode http"].join("\n"),
    updatedDefinition: ["cache pages", "    total-max-size 4"].join("\n"),
    referenceContent: ["frontend web", "    bind :80", "    http-request cache-use pages"].join(
      "\n",
    ),
    referenceLine: 2,
    referenceCol: "    http-request cache-use ".length,
  },
  {
    label: "userlist",
    kind: "userlist",
    name: "stats-auth",
    unusedCode: "unused-symbol",
    expectMissingBefore: true,
    definitionUri: "file:///test_dir/haproxy.d/auth.cfg",
    referenceUri: "file:///test_dir/haproxy.d/frontends/web.cfg",
    initialDefinition: ["defaults", "    mode http"].join("\n"),
    updatedDefinition: ["userlist stats-auth", "    user admin insecure-password admin"].join("\n"),
    referenceContent: ["frontend web", "    bind :80", "    acl AUTH http_auth(stats-auth)"].join(
      "\n",
    ),
    referenceLine: 2,
    referenceCol: "    acl AUTH http_auth(".length,
  },
  {
    label: "resolvers",
    kind: "resolvers",
    name: "dns-main",
    unusedCode: "unused-symbol",
    expectMissingBefore: true,
    definitionUri: "file:///test_dir/haproxy.d/dns.cfg",
    referenceUri: "file:///test_dir/haproxy.d/backends/api.cfg",
    initialDefinition: ["defaults", "    mode http"].join("\n"),
    updatedDefinition: ["resolvers dns-main", "    nameserver ns1 127.0.0.1:53"].join("\n"),
    referenceContent: ["backend api", "    server s1 host.local:80 resolvers dns-main"].join("\n"),
    referenceLine: 1,
    referenceCol: "    server s1 host.local:80 resolvers ".length,
  },
  {
    label: "setenv",
    kind: "environment-variable",
    name: "FOO",
    unusedCode: "unused-symbol",
    expectMissingBefore: false,
    definitionUri: "file:///test_dir/haproxy.d/global.cfg",
    referenceUri: "file:///test_dir/haproxy.d/frontends/web.cfg",
    initialDefinition: ["global", "    daemon"].join("\n"),
    updatedDefinition: ["global", "    daemon", "    setenv FOO bar"].join("\n"),
    referenceContent: ["frontend web", "    bind :80", '    log "${FOO-default}:514" local0'].join(
      "\n",
    ),
    referenceLine: 2,
    referenceCol: '    log "${'.length,
  },
];

function definitionTargetUri(definition: ReturnType<typeof provideDefinition>): string | undefined {
  if (!definition) {
    return undefined;
  }
  const target = Array.isArray(definition) ? definition[0] : definition;
  if (!target) {
    return undefined;
  }
  if ("targetUri" in target) {
    return target.targetUri.toString();
  }
  return target.uri.toString();
}

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
      maxSymbolLines: 4000,
    });

    expect(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference"),
    ).toHaveLength(1);
    expect(
      diagnostics.find((diag) => formatDiagnosticCode(diag.code) === "missing-reference")?.message,
    ).toContain("not defined in this workspace");
  });

  it("does not resolve backend references to same-named frontend sections", async () => {
    const content = ["frontend api", "frontend web", "    use_backend api"].join("\n");
    setMockWorkspaceFile("file:///frontends/web.cfg", content);
    const document = createDocument(content, "file:///frontends/web.cfg");
    mockTextDocuments.push(document as never);

    await buildWorkspace();

    const diagnostics = computeDiagnostics(document, schema, {
      unusedSymbols: false,
      missingReferences: true,
      maxSymbolLines: 4000,
    });

    expect(
      diagnostics.filter((diag) => formatDiagnosticCode(diag.code) === "missing-reference"),
    ).toHaveLength(1);
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
      maxSymbolLines: 4000,
    });
    const backendDiags = computeDiagnostics(backend, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxSymbolLines: 4000,
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
      maxSymbolLines: 4000,
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

  it.each(namedSectionIncrementalCases)(
    "picks up a new $label in nested haproxy.d files after only the definition file changes",
    async (tc) => {
      const include = ["**/haproxy.d/**/*.cfg", "**/haproxy.d/*.cfg"];

      setMockWorkspaceFolders([workspaceFolder("file:///test_dir")]);
      setMockWorkspaceFile(tc.definitionUri, tc.initialDefinition);
      setMockWorkspaceFile(tc.referenceUri, tc.referenceContent);
      const definitionDoc = createDocument(tc.initialDefinition, tc.definitionUri);
      const referenceDoc = createDocument(tc.referenceContent, tc.referenceUri);
      mockTextDocuments.push(definitionDoc as never, referenceDoc as never);

      await buildWorkspace(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, include);

      const before = computeDiagnostics(referenceDoc, schema, symbolDiagnosticOptions);
      expect(
        before.filter(
          (diag) =>
            formatDiagnosticCode(diag.code) === "missing-reference" &&
            diag.message.includes(tc.name),
        ),
      ).toHaveLength(tc.expectMissingBefore ? 1 : 0);

      updateDocument(definitionDoc, tc.updatedDefinition);
      setMockWorkspaceFile(tc.definitionUri, tc.updatedDefinition);
      scheduleWorkspaceSymbolIndexRebuild(
        schema,
        defaultWorkspaceSymbolSettings({ include }),
        4000,
        {
          scope: "incremental",
          document: definitionDoc,
        },
      );
      await vi.runAllTimersAsync();
      await Promise.resolve();

      const workspaceIndex = expectWorkspaceIndex(getWorkspaceSymbolIndex(referenceDoc));
      expect(workspaceIndex.documents.has(tc.referenceUri)).toBe(true);
      expect(findWorkspaceDefinitions(workspaceIndex, tc.kind, tc.name, null)).toHaveLength(1);
      expect(
        findWorkspaceReferences(workspaceIndex, tc.kind, tc.name, null).length,
      ).toBeGreaterThan(0);

      const afterReference = computeDiagnostics(referenceDoc, schema, symbolDiagnosticOptions);
      expect(
        afterReference.filter(
          (diag) =>
            formatDiagnosticCode(diag.code) === "missing-reference" &&
            diag.message.includes(tc.name),
        ),
      ).toHaveLength(0);
      expect(
        computeDiagnostics(definitionDoc, schema, symbolDiagnosticOptions).filter(
          (diag) =>
            formatDiagnosticCode(diag.code) === tc.unusedCode && diag.message.includes(tc.name),
        ),
      ).toHaveLength(0);

      const definition = provideDefinition(
        referenceDoc,
        pos(tc.referenceLine, tc.referenceCol),
        schema,
        4000,
      );
      expect(definition).not.toBeNull();
      expect(definitionTargetUri(definition)).toBe(tc.definitionUri);
    },
  );

  it("does not republish the workspace graph when an edit does not change symbols", async () => {
    const globalUri = "file:///global.cfg";
    const backendUri = "file:///backends/api.cfg";
    const globalContent = ["global", "    maxconn 4096"].join("\n");
    const backendContent = ["backend api", "    server s1 127.0.0.1:80"].join("\n");

    setMockWorkspaceFile(globalUri, globalContent);
    setMockWorkspaceFile(backendUri, backendContent);
    const globalDoc = createDocument(globalContent, globalUri);
    const backendDoc = createDocument(backendContent, backendUri);
    mockTextDocuments.push(globalDoc as never, backendDoc as never);

    await buildWorkspace();
    computeDiagnostics(backendDoc, schema, symbolDiagnosticOptions);
    const before = expectWorkspaceIndex(getWorkspaceSymbolIndex(globalDoc));
    const beforeRevision = before.revision;
    const beforeBackendIndex = before.documents.get(backendUri)?.index;

    const listener = vi.fn();
    setWorkspaceSymbolIndexChangeListener(listener);

    const updatedGlobal = ["global", "    maxconn 8192"].join("\n");
    updateDocument(globalDoc, updatedGlobal);
    setMockWorkspaceFile(globalUri, updatedGlobal);
    scheduleWorkspaceSymbolIndexRebuild(schema, defaultWorkspaceSymbolSettings(), 4000, {
      scope: "incremental",
      document: globalDoc,
    });
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    const after = expectWorkspaceIndex(getWorkspaceSymbolIndex(globalDoc));
    expect(after.revision).toBe(beforeRevision);
    expect(after.documents.get(backendUri)?.index).toBe(beforeBackendIndex);
    expect(
      computeDiagnostics(backendDoc, schema, symbolDiagnosticOptions).some(
        (diag) => formatDiagnosticCode(diag.code) === "unused-section",
      ),
    ).toBe(true);
  });
});
