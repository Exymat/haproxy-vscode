import { extractAclConditionSpans, validateAclConditions } from "../../src/aclCondition";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");

describe("extractAclConditionSpans", () => {
  it("extracts brace bodies and skips sample expressions", () => {
    const spans = extractAclConditionSpans("deny if { path /api } hdr %[src] { meth GET }");
    expect(spans).toHaveLength(2);
    expect(spans[0].text.trim()).toBe("path /api");
    expect(spans[1].text.trim()).toBe("meth GET");
  });

  it("handles unclosed braces", () => {
    const spans = extractAclConditionSpans("deny if { path /api");
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe(" path /api");
  });

  it("respects quoted braces", () => {
    const spans = extractAclConditionSpans('deny if { path "/not{a}brace" }');
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toContain("/not{a}brace");
  });

  it("respects single-quoted braces", () => {
    const spans = extractAclConditionSpans("deny if { path '/not{a}brace' }");
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toContain("/not{a}brace");
  });
});

describe("validateAclConditions", () => {
  it("validates parenthesized sample fetches", () => {
    const issues = validateAclConditions("deny if { (not_a_fetch) }", schema);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("skips acl-only criteria calls", () => {
    const issues = validateAclConditions("deny if { base_beg /api }", schema);
    expect(issues).toEqual([]);
  });

  it("validates bare fetch names at end of span", () => {
    const issues = validateAclConditions("deny if { src }", schema);
    expect(issues).toEqual([]);
  });

  it("validates function calls that are not acl-only", () => {
    const issues = validateAclConditions("deny if { path(0) }", schema);
    expect(issues.some((i) => i.code === "sample-fetch-args")).toBe(true);
  });

  it("parses fetch calls with quoted arguments", () => {
    const issues = validateAclConditions('deny if { req.hdr("host") }', schema);
    expect(issues).toEqual([]);
  });

  it("parses fetch calls with single-quoted arguments", () => {
    const issues = validateAclConditions("deny if { req.hdr('host') }", schema);
    expect(issues).toEqual([]);
  });
});
