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

  it("skips %{...} log-format style braces while still finding ACL blocks", () => {
    const spans = extractAclConditionSpans("http-request set-log-level silent if %{+Q}o { src }");
    expect(spans).toHaveLength(1);
    expect(spans[0].text.trim()).toBe("src");
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

  it("skips acl-only criteria calls with parenthesized values", () => {
    const issues = validateAclConditions("deny if { base_beg(/api) }", schema);
    expect(issues).toEqual([]);
  });

  it("validates bare fetch names at end of span", () => {
    const issues = validateAclConditions("deny if { src }", schema);
    expect(issues).toEqual([]);
  });

  it("validates truncated bare fetches that require arguments", () => {
    const customSchema = structuredClone(schema);
    customSchema.sample_fetches = {
      ...customSchema.sample_fetches,
      needs_arg: {
        name: "needs_arg",
        args: ["string"],
        out_type: "str",
        min_args: 1,
        max_args: 1,
      },
    };
    const issues = validateAclConditions("deny if { needs_arg }", customSchema);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "sample-fetch-args" });
    expect(issues[0]?.message).toContain("expected type 'string'");
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

  it("ignores parentheses inside quoted regex patterns", () => {
    const issues = validateAclConditions(
      'use_backend non_www if { var(http_host) -m reg -p "^(?!www\\.).*" }',
      schema,
    );
    expect(issues).toEqual([]);
  });

  it("ignores parentheses inside single-quoted regex patterns", () => {
    const issues = validateAclConditions(
      "deny if { var(http_host) -m reg -p '(?!group)' }",
      schema,
    );
    expect(issues).toEqual([]);
  });

  it("validates var() fetches in inline conditions", () => {
    const issues = validateAclConditions("deny if { var(txn.myip) -m found }", schema);
    expect(issues).toEqual([]);
  });

  it("handles schemas without sample fetch or converter maps", () => {
    const customSchema = structuredClone(schema);
    customSchema.sample_fetches = undefined as never;
    customSchema.sample_converters = undefined as never;
    expect(validateAclConditions("deny if { not_a_fetch() }", customSchema)).toEqual([
      expect.objectContaining({ code: "sample-unknown-fetch" }),
    ]);
  });
});
