import { parseDocument } from "../../src/parser";
import { aclNameDiagnostics, sectionHeaderDiagnostics } from "../../src/sectionDiagnostics";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");

function headerDiagnosticCodes(content: string, lineNo = 0): string[] {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  return sectionHeaderDiagnostics(parsed[lineNo], schema).map((d) => d.code as string);
}

function aclDiagnosticCodes(content: string, lineNo = 1): string[] {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  return aclNameDiagnostics(parsed[lineNo]).map((d) => d.code as string);
}

describe("sectionHeaderDiagnostics", () => {
  it("returns empty for non-section lines", () => {
    expect(headerDiagnosticCodes("global\n    daemon", 1)).toEqual([]);
    expect(headerDiagnosticCodes("defaults", 0)).toEqual([]);
  });

  it("flags invalid section names", () => {
    const codes = headerDiagnosticCodes("frontend web@prod");
    expect(codes).toContain("invalid-name");
  });

  it("flags legacy bind syntax on frontend without from keyword", () => {
    const codes = headerDiagnosticCodes("frontend web :443");
    expect(codes).toContain("legacy-bind-syntax");
  });

  it("allows from keyword before address tokens on frontend", () => {
    const codes = headerDiagnosticCodes("frontend web from profile :443");
    expect(codes).not.toContain("legacy-bind-syntax");
  });

  it("flags legacy bind syntax on listen section", () => {
    const codes = headerDiagnosticCodes("listen stats *:8888");
    expect(codes).toContain("legacy-bind-syntax");
  });

  it("flags legacy bind syntax for numeric listen addresses", () => {
    const codes = headerDiagnosticCodes("listen stats 127.0.0.1:8888");
    expect(codes).toContain("legacy-bind-syntax");
  });

  it("covers additional legacy bind syntax edge cases", () => {
    expect(headerDiagnosticCodes("frontend web 127.0.0.1:8080")).toContain("legacy-bind-syntax");
    expect(headerDiagnosticCodes("frontend web *:443 extra")).toContain("legacy-bind-syntax");
    expect(headerDiagnosticCodes("frontend web from profile *:443")).not.toContain(
      "legacy-bind-syntax",
    );
    expect(headerDiagnosticCodes("frontend web profile *:443")).toContain("legacy-bind-syntax");
  });
});

describe("aclNameDiagnostics", () => {
  it("returns empty for non-acl lines", () => {
    expect(aclDiagnosticCodes("frontend web\n    bind :80", 1)).toEqual([]);
    expect(aclDiagnosticCodes("frontend web\n    acl short", 1)).toEqual([]);
  });

  it("flags invalid acl names", () => {
    const codes = aclDiagnosticCodes("frontend web\n    acl bad@name path -m beg /");
    expect(codes).toContain("invalid-name");
  });

  it("accepts valid acl names", () => {
    expect(aclDiagnosticCodes("frontend web\n    acl is_api path -m beg /api")).toEqual([]);
  });
});
