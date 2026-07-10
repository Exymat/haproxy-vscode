import { parseDocument } from "../helpers/parse";
import { namedDefaultsDiagnostics } from "../../src/namedDefaultsDiagnostics";
import { createDocument } from "../helpers/document";
import { loadSchema } from "../helpers/schema";

const schema34 = loadSchema("3.4");

function diagnosticCodes(content: string, lineNo = 1): string[] {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  return namedDefaultsDiagnostics(parsed[lineNo], schema34).map((d) => d.code as string);
}

describe("namedDefaultsDiagnostics", () => {
  it("warns for named-defaults keywords in anonymous defaults on 3.4", () => {
    const codes = diagnosticCodes("defaults\n    acl is_api path -m beg /api");
    expect(codes).toContain("named-defaults-required");
  });

  it("does not warn in named defaults sections", () => {
    const codes = diagnosticCodes("defaults profile_a\n    acl is_api path -m beg /api");
    expect(codes).toEqual([]);
  });

  it("does not warn outside defaults section", () => {
    const codes = diagnosticCodes("frontend web\n    acl is_api path -m beg /api");
    expect(codes).toEqual([]);
  });

  it("does not warn for keywords allowed in anonymous defaults", () => {
    const codes = diagnosticCodes("defaults\n    mode http");
    expect(codes).toEqual([]);
  });

  it("returns empty when named defaults keywords are absent", () => {
    const schema = structuredClone(schema34);
    schema.tokens.named_defaults_keywords = [];
    const doc = createDocument("defaults\n    acl is_api path -m beg /api");
    const parsed = parseDocument(doc);
    expect(namedDefaultsDiagnostics(parsed[1], schema)).toEqual([]);
  });
});
