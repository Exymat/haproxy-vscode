import { computeDiagnostics } from "../../../src/diagnostics";
import { provideDefinition, provideReferences } from "../../../src/navigation";
import { mockTextDocuments, setMockWorkspaceFile } from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";

import { buildWorkspace, pos, schema, setupWorkspaceSymbolIndexTests } from "./helpers";

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
});
