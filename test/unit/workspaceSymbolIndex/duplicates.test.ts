import { computeDiagnostics } from "../../../src/diagnostics";
import { duplicateSectionDiagnostics } from "../../../src/duplicateSymbolDiagnostics";
import {
  buildWorkspaceSymbolIndexFromOpenDocuments,
  findWorkspaceDefinitions,
} from "../../../src/symbolIndex";
import { mockTextDocuments, setMockWorkspaceFile } from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";

import {
  buildWorkspace,
  expectWorkspaceDocumentSymbols,
  schema,
  setupWorkspaceSymbolIndexTests,
} from "./helpers";

describe("workspace symbol index duplicates", () => {
  setupWorkspaceSymbolIndexTests();

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
});
