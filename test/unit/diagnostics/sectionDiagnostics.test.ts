import { parseDocument } from "../../helpers/parse";
import {
  aclNameDiagnostics,
  sectionHeaderDiagnostics,
} from "../../../src/diagnostics/sectionDiagnostics";
import { namedSectionSet } from "../../../src/schema/symbols";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");
const sectionCtx = {
  namedSections: namedSectionSet(schema),
  schema,
};

function headerDiagnosticCodes(content: string, lineNo = 0): string[] {
  const doc = createDocument(content);
  const parsed = parseDocument(doc);
  return sectionHeaderDiagnostics(parsed[lineNo], sectionCtx).map((d) => d.code as string);
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

  it("flags address-like tokens on frontend section headers as extra arguments", () => {
    expect(headerDiagnosticCodes("frontend web :443")).toContain("extra-argument");
    expect(headerDiagnosticCodes("frontend web 127.0.0.1:8080")).toContain("extra-argument");
    expect(headerDiagnosticCodes("frontend web *:443 extra")).toContain("extra-argument");
    expect(headerDiagnosticCodes("frontend web profile *:443")).toContain("extra-argument");
  });

  it("flags address-like tokens after from profile as extra arguments", () => {
    expect(headerDiagnosticCodes("frontend web from profile :443")).toContain("extra-argument");
    expect(headerDiagnosticCodes("frontend web from profile *:443")).toContain("extra-argument");
  });

  it("flags address-like tokens on listen section headers as extra arguments", () => {
    expect(headerDiagnosticCodes("listen stats *:8888")).toContain("extra-argument");
    expect(headerDiagnosticCodes("listen stats 127.0.0.1:8888")).toContain("extra-argument");
  });

  it("flags extra tokens on proxy section headers", () => {
    expect(headerDiagnosticCodes("frontend web extra")).toContain("extra-argument");
    expect(headerDiagnosticCodes("backend api extra from base")).toContain("extra-argument");
    expect(headerDiagnosticCodes("frontend web-prod from base")).toEqual([]);
    expect(headerDiagnosticCodes("frontend web_prod from base")).toEqual([]);
    expect(headerDiagnosticCodes("frontend web from base")).toEqual([]);
  });

  it("flags extra tokens on simple named section headers", () => {
    expect(headerDiagnosticCodes("peers p1 extra")).toContain("extra-argument");
    expect(headerDiagnosticCodes("defaults d extra from base")).toContain("extra-argument");
  });

  it("flags extra tokens after defaults from profile", () => {
    expect(headerDiagnosticCodes("defaults from base extra")).toContain("extra-argument");
  });

  it("uses the defaults section fallback when schema omits defaults_section_name", () => {
    const schemaWithoutDefaultsName = structuredClone(schema);
    schemaWithoutDefaultsName.symbols = {
      ...schemaWithoutDefaultsName.symbols,
      defaults_section_name: undefined,
    };
    const doc = createDocument("defaults from base extra");
    const parsed = parseDocument(doc);
    const codes = sectionHeaderDiagnostics(parsed[0], {
      ...sectionCtx,
      schema: schemaWithoutDefaultsName,
    }).map((d) => d.code as string);
    expect(codes).toContain("extra-argument");
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
