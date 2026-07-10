import { expressionDiagnostics } from "../../../src/expressionDiagnostics";
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
});
