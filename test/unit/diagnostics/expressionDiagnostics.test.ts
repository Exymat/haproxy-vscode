import * as vscode from "vscode";

import { computeDiagnostics } from "../../../src/diagnostics";
import { expressionDiagnostics } from "../../../src/diagnostics/expressionDiagnostics";
import { parseDocument } from "../../helpers/parse";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

describe("expressionDiagnostics", () => {
  it("reports invalid sample expressions with source and code", () => {
    const content = "frontend web\n    http-request add-header n %[not_a_fetch]";
    const doc = createDocument(content);
    const line = parseDocument(doc)[1];
    const lineText = doc.lineAt(1).text;
    const diags = expressionDiagnostics(line, lineText, schema);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe(0);
    expect(diags[0].source).toBeTruthy();
    expect(diags[0].code).toBeTruthy();
    expect(diags[0].range.start.line).toBe(1);
  });

  it("includes acl condition validation issues", () => {
    const content = "frontend web\n    http-request deny if { not_a_fetch() }";
    const doc = createDocument(content);
    const line = parseDocument(doc)[1];
    const diags = expressionDiagnostics(line, doc.lineAt(1).text, schema);
    expect(diags.some((d) => formatDiagnosticCode(d.code).includes("sample"))).toBe(true);
  });

  it("keeps unknown fetches as errors without lua-load", () => {
    const content = ["frontend web", "    http-request set-header X-A %[custom_lua_fetch()]"].join(
      "\n",
    );
    const diags = computeDiagnostics(createDocument(content), schema, {
      unusedSymbols: false,
      missingReferences: false,
    }).filter((d) => d.code === "sample-unknown-fetch");
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe(vscode.DiagnosticSeverity.Error);
  });

  it("downgrades unknown fetches to hints when lua-load is present", () => {
    const content = [
      "global",
      "    lua-load /etc/haproxy/custom.lua",
      "frontend web",
      "    http-request set-header X-A %[custom_lua_fetch()]",
    ].join("\n");
    const diags = computeDiagnostics(createDocument(content), schema, {
      unusedSymbols: false,
      missingReferences: false,
    }).filter((d) => d.code === "sample-unknown-fetch");
    expect(diags).toHaveLength(1);
    expect(diags[0]?.severity).toBe(vscode.DiagnosticSeverity.Hint);
  });

  it("softens unknown samples when softUnknownSamples is requested", () => {
    const softLine = {
      line: 1,
      tokens: [{ text: "http-request", start: 4, end: 16 }],
      section: "frontend",
      isSectionHeader: false,
      anonymousDefaults: false,
    };
    const soft = expressionDiagnostics(
      softLine,
      "    http-request set-header X %[custom_lua_fetch()]",
      schema,
      [],
      { softUnknownSamples: true },
    );
    expect(soft.some((diag) => diag.code === "sample-unknown-fetch")).toBe(true);
    expect(soft.every((diag) => diag.severity === vscode.DiagnosticSeverity.Hint)).toBe(true);
  });
});
