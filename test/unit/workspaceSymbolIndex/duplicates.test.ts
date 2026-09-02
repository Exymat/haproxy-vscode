import { computeDiagnostics } from "../../../src/diagnostics";
import { duplicateSectionDiagnostics } from "../../../src/diagnostics/duplicateSymbolDiagnostics";
import { getParsedDocument } from "../../../src/parser/parseCache";
import { sectionHeaderSet } from "../../../src/schema/layout";
import {
  buildWorkspaceSymbolIndexFromOpenDocuments,
  findWorkspaceDefinitions,
} from "../../../src/symbolIndex";
import { mockTextDocuments, setMockWorkspaceFile } from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import type { HaproxySchema } from "../../../src/schema/types";

import { buildWorkspace, schema, setupWorkspaceSymbolIndexTests } from "./helpers";

function parsedLines(
  document: ReturnType<typeof createDocument>,
  activeSchema: HaproxySchema = schema,
) {
  return getParsedDocument(document, { sectionHeaders: sectionHeaderSet(activeSchema) });
}

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
      maxSymbolLines: 4000,
    });
    const secondDiags = computeDiagnostics(second, schema, {
      unusedSymbols: true,
      missingReferences: true,
      maxSymbolLines: 4000,
    });

    expect(
      firstDiags.filter((d) => formatDiagnosticCode(d.code) === "duplicate-section"),
    ).toHaveLength(1);
    expect(
      secondDiags.filter((d) => formatDiagnosticCode(d.code) === "duplicate-section"),
    ).toHaveLength(1);
  });

  it("permits frontend/backend name reuse but reports overlapping listen capabilities", () => {
    const document = createDocument(
      "frontend shared\nbackend shared\nlisten shared",
      "file:///capabilities.cfg",
    );
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments([document], schema, 4000);
    const diagnostics = duplicateSectionDiagnostics(
      document,
      parsedLines(document),
      workspaceIndex,
      schema,
    );

    expect(diagnostics.map((diagnostic) => diagnostic.range.start.line).sort()).toEqual([0, 1, 2]);

    const legalDocument = createDocument(
      "frontend shared\nbackend shared",
      "file:///legal-capabilities.cfg",
    );
    const legalIndex = buildWorkspaceSymbolIndexFromOpenDocuments([legalDocument], schema, 4000);
    expect(
      duplicateSectionDiagnostics(legalDocument, parsedLines(legalDocument), legalIndex, schema),
    ).toEqual([]);
  });

  it("treats differently-cased proxy names as distinct", () => {
    const document = createDocument("backend api\nbackend API", "file:///case-sensitive.cfg");
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments([document], schema, 4000);

    expect(
      duplicateSectionDiagnostics(document, parsedLines(document), workspaceIndex, schema),
    ).toEqual([]);
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
      parsedLines(document),
      workspaceIndex,
      schema,
    );

    expect(diagnostics.map((diag) => diag.message)).toEqual(
      expect.arrayContaining([
        "Duplicate Defaults profile 'base' is also defined in this file",
        "Duplicate cache section 'shared' is also defined in this file",
        "Duplicate Userlist 'auth' is also defined in this file",
        "Duplicate resolvers section 'dns' is also defined in this file",
        "Duplicate peers section 'cluster' is also defined in this file",
      ]),
    );
  });

  it("uses proxy-section fallback labels for malformed duplicate headers", () => {
    const first = createDocument("backend api", "file:///a.cfg");
    const second = createDocument("backend api", "file:///b.cfg");
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments(
      [first, second],
      schema,
      4000,
    );
    const parsed = structuredClone(parsedLines(first));
    parsed[0] = { ...parsed[0], tokens: [] };
    const diagnostics = duplicateSectionDiagnostics(first, parsed, workspaceIndex, schema);
    expect(diagnostics[0]?.message).toContain("Duplicate proxy section 'api'");
  });

  it("falls back to raw symbol kind ids when labels are missing", () => {
    const customSchema = structuredClone(schema);
    const labels = {
      ...(customSchema.symbols.symbol_kind_labels as Record<string, string>),
    };
    delete labels.cache;
    customSchema.symbols = { ...customSchema.symbols, symbol_kind_labels: labels };
    const document = createDocument("cache shared\ncache shared", "file:///cache-fallback.cfg");
    const workspaceIndex = buildWorkspaceSymbolIndexFromOpenDocuments(
      [document],
      customSchema,
      4000,
    );
    const parsed = structuredClone(parsedLines(document, customSchema));
    const diagnostics = duplicateSectionDiagnostics(document, parsed, workspaceIndex, customSchema);
    expect(diagnostics[0]?.message).toContain("Duplicate cache 'shared'");
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
      parsedLines(first),
      workspaceIndex,
      schema,
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
      parsedLines(document),
      workspaceIndex,
      schema,
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
      maxSymbolLines: 4000,
    });

    expect(diags.filter((d) => formatDiagnosticCode(d.code) === "duplicate-section")).toHaveLength(
      0,
    );
  });
});
