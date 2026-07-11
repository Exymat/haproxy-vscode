import {
  extractExpressionSpans,
  validateExpressionBody,
  validateSampleExpressions,
} from "../../../src/language/sampleExpression";
import { findClosingBrace, findExprEnd, parseArgList } from "../../../src/parser/expressionParsing";
import { readGoldenFixture } from "../../helpers/fixtures";
import { loadSchema } from "../../helpers/schema";

const schema32 = loadSchema("3.2");

function codesForLine(line: string) {
  return validateSampleExpressions(line, schema32).map((d) => d.code);
}

describe("extractExpressionSpans", () => {
  it("extracts one span per %[ ... ] block", () => {
    const spans = extractExpressionSpans("set-header X %[src], Y %[dst]");
    expect(spans).toHaveLength(2);
    expect(spans[0].text).toBe("src");
    expect(spans[1].text).toBe("dst");
  });

  it("handles unclosed %[ expressions", () => {
    const spans = extractExpressionSpans("hdr %[req.hdr(");
    expect(spans).toEqual([{ text: "req.hdr(", start: 6 }]);
  });

  it("ignores acl brace syntax", () => {
    expect(extractExpressionSpans("if { always_true }")).toEqual([]);
  });
});

describe("validateSampleExpressions inline", () => {
  it("returns no issue for empty or identifier-free bodies without a fetch call", () => {
    expect(validateExpressionBody("", 0, {}, {}, new Set(), new Set(), schema32)).toEqual([]);
    expect(validateExpressionBody("   ", 0, {}, {}, new Set(), new Set(), schema32)).toEqual([]);
  });

  it("reports missing fetch for parenthesized body", () => {
    expect(codesForLine("http-request add-header n %[()]")).toContain("sample-missing-fetch");
  });

  it("reports unknown fetch methods", () => {
    expect(codesForLine("http-request add-header n %[not_a_fetch]")).toContain(
      "sample-unknown-fetch",
    );
  });

  it("ignores wurfl fetch prefixes", () => {
    expect(codesForLine("http-request add-header n %[wurfl-device-id]")).toEqual([]);
  });

  it("reports unknown converters", () => {
    expect(codesForLine("http-request add-header n %[src,not_a_converter]")).toContain(
      "sample-unknown-converter",
    );
  });

  it("reports converter cast errors", () => {
    expect(codesForLine("http-request add-header n %[always_false,ipmask]")).toContain(
      "sample-converter-cast",
    );
  });

  it("reports syntax errors for trailing tokens", () => {
    expect(codesForLine("http-request add-header n %[src extra]")).toContain("sample-syntax");
  });

  it("reports unclosed quotes in arguments", () => {
    expect(codesForLine('http-request add-header n %[req.hdr("x]')).toContain("sample-syntax");
  });

  it("validates integer fetch arguments", () => {
    expect(codesForLine("http-request add-header n %[payload_lv(0,0)]")).toContain(
      "sample-fetch-args",
    );
  });

  it("parses single-quoted and escaped fetch arguments", () => {
    expect(codesForLine("http-request add-header n %[req.hdr('host\\n')]")).toEqual([]);
    expect(codesForLine("http-request add-header n %[req.hdr('bad]")).toContain("sample-syntax");
  });

  it("parses double-quoted escaped fetch arguments", () => {
    expect(codesForLine('http-request add-header n %[req.hdr("host\\r\\n\\t\\"x\\"")]')).toEqual(
      [],
    );
  });

  it("reports fetch and converter argument shape errors", () => {
    expect(codesForLine("http-request add-header n %[src,ipmask(bad)]")).toContain(
      "sample-converter-args",
    );
    expect(codesForLine("http-request add-header n %[src,ipmask(1.2.3.4/32,not-ipv6)]")).toContain(
      "sample-converter-args",
    );
    expect(codesForLine("http-request add-header n %[src,map(file,key,extra)]")).toContain(
      "sample-converter-args",
    );
    expect(codesForLine("http-request add-header n %[src,ipmask()]")).toContain(
      "sample-converter-args",
    );
    expect(codesForLine("http-request add-header n %[src,map(,key)]")).toContain(
      "sample-fetch-args",
    );
    expect(codesForLine("http-request add-header n %[src,)]")).toContain("sample-syntax");
  });

  it("reports unexpected fetch arguments and missing converter commas", () => {
    expect(codesForLine("http-request add-header n %[path(0,extra)]")).toContain(
      "sample-fetch-args",
    );
    expect(codesForLine("http-request add-header n %[src,lower,extra)]")).toContain(
      "sample-unknown-converter",
    );
  });

  it("reports malformed argument lists and cast failures", () => {
    expect(
      validateExpressionBody(
        "custom(a,b)c",
        0,
        {
          custom: { name: "custom", args: ["string", "string"], out_type: "str" },
        },
        {},
        new Set(["custom"]),
        new Set(),
        schema32,
      ).map((d) => d.code),
    ).toContain("sample-syntax");
    expect(codesForLine("http-request add-header n %[payload_lv(1,2,x,extra)]")).toContain(
      "sample-fetch-args",
    );
    expect(codesForLine('http-request add-header n %[req.hdr("a\\z")]')).toEqual([]);
    expect(
      validateExpressionBody(
        "src,same_conv",
        0,
        schema32.sample_fetches ?? {},
        { same_conv: { name: "same_conv", args: [], in_type: "str", out_type: "same" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["same_conv"]),
        schema32,
      ),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "always_false,addr_conv",
        0,
        schema32.sample_fetches ?? {},
        { addr_conv: { name: "addr_conv", args: [], in_type: "addr", out_type: "addr" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["addr_conv"]),
        schema32,
      ).some((d) => d.code === "sample-converter-cast"),
    ).toBe(true);
    expect(
      validateExpressionBody(
        "custom_fetch,lower",
        0,
        { custom_fetch: { name: "custom_fetch", args: [], out_type: "not-a-type" } },
        schema32.sample_converters ?? {},
        new Set(["custom_fetch"]),
        new Set(Object.keys(schema32.sample_converters ?? {})),
        schema32,
      ),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "custom_fetch,same_out",
        0,
        { custom_fetch: { name: "custom_fetch", args: [], out_type: "not-a-type" } },
        { same_out: { name: "same_out", args: [], in_type: "same", out_type: "same" } },
        new Set(["custom_fetch"]),
        new Set(["same_out"]),
        schema32,
      ),
    ).toEqual([]);
    expect(codesForLine('http-request add-header n %[payload_lv("0" junk)]')).toContain(
      "sample-fetch-args",
    );
    expect(codesForLine("http-request add-header n %[payload_lv(0,)]")).toContain(
      "sample-fetch-args",
    );
    expect(
      validateExpressionBody(
        "src,no_cast",
        0,
        schema32.sample_fetches ?? {},
        { no_cast: { name: "no_cast", args: [], in_type: "bin", out_type: "same" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["no_cast"]),
        schema32,
      ),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "src,any_in",
        0,
        schema32.sample_fetches ?? {},
        { any_in: { name: "any_in", args: [], in_type: "not-a-type", out_type: "str" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["any_in"]),
        schema32,
      ),
    ).toEqual([]);
    expect(codesForLine("http-request add-header n %[path(0 junk)]")).toContain(
      "sample-fetch-args",
    );
    expect(codesForLine("http-request add-header n %[path(0,)]")).toContain("sample-fetch-args");
  });
  it("honors explicit min_args on sample fetches", () => {
    const schema = structuredClone(schema32);
    schema.sample_fetches.custom = {
      name: "custom",
      args: ["string"],
      out_type: "str",
      min_args: 1,
      max_args: 1,
    };
    expect(
      validateSampleExpressions("http-request add-header n %[custom()]", schema).some(
        (d) => d.code === "sample-fetch-args",
      ),
    ).toBe(true);
  });

  it("reports empty and missing required arguments directly from the parser", () => {
    const customFetches = {
      required_fetch: {
        name: "required_fetch",
        args: ["integer", "integer"],
        out_type: "int",
        min_args: 2,
        max_args: 2,
      },
    };
    expect(
      validateExpressionBody(
        "required_fetch(,2)",
        0,
        customFetches,
        {},
        new Set(["required_fetch"]),
        new Set(),
        schema32,
      )[0]?.code,
    ).toBe("sample-fetch-args");
    expect(
      validateExpressionBody(
        "required_fetch(1)",
        0,
        customFetches,
        {},
        new Set(["required_fetch"]),
        new Set(),
        schema32,
      )[0]?.code,
    ).toBe("sample-fetch-args");
    expect(parseArgList("required_fetch", "required_fetch".length, 0, [], 1).error?.message).toBe(
      "expected type 'argument' at position 1, but got nothing",
    );
  });

  it("covers direct expression and brace scan helpers", () => {
    expect(findExprEnd("outer(inner()) tail", 5)).toBe("outer(inner())".length);
    expect(findExprEnd('outer(")")', 5)).toBe('outer(")")'.length);
    expect(findClosingBrace("if { hdr(host) -m str example } tail", 3)).toBe(
      "if { hdr(host) -m str example }".length - 1,
    );
    expect(findClosingBrace("if { str('}') }", 3)).toBe("if { str('}') }".length - 1);
    expect(findClosingBrace("if { outer { inner } } tail", 3)).toBe(
      "if { outer { inner } }".length - 1,
    );
    expect(parseArgList("fetch()", "fetch".length, 0, ["string"], 1).error?.message).toContain(
      "expected type 'string'",
    );
    expect(
      parseArgList("fetch(1)", "fetch".length, 0, ["integer", "integer"], 2).error?.message,
    ).toContain("missing arguments");
  });

  it("accepts valid IPv6 mask converter args and rejects zero-arg converters with args", () => {
    expect(
      validateExpressionBody(
        "src,mask6(2001:db8::/64)",
        0,
        schema32.sample_fetches ?? {},
        { mask6: { name: "mask6", args: ["IPv6 mask"], in_type: "str", out_type: "str" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["mask6"]),
        schema32,
      ),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "src,noargs(1)",
        0,
        schema32.sample_fetches ?? {},
        { noargs: { name: "noargs", args: [], in_type: "str", out_type: "str" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["noargs"]),
        schema32,
      )[0]?.code,
    ).toBe("sample-converter-args");
  });

  it("uses fetch and converter name sets when metadata entries are absent", () => {
    expect(
      validateExpressionBody("known", 0, {}, {}, new Set(["known"]), new Set(), schema32),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "src,fallbackconv",
        0,
        schema32.sample_fetches ?? {},
        {},
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["fallbackconv"]),
        schema32,
      ),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "compat_fetch,lower",
        0,
        { compat_fetch: { name: "compat_fetch", args: [] } as never },
        schema32.sample_converters ?? {},
        new Set(["compat_fetch"]),
        new Set(Object.keys(schema32.sample_converters ?? {})),
        schema32,
      ),
    ).toEqual([]);
    expect(
      validateExpressionBody(
        "src,compat_conv",
        0,
        schema32.sample_fetches ?? {},
        { compat_conv: { name: "compat_conv", args: [], out_type: "str" } },
        new Set(Object.keys(schema32.sample_fetches ?? {})),
        new Set(["compat_conv"]),
        schema32,
      ),
    ).toEqual([]);
  });

  it("handles schemas without sample fetch or converter maps", () => {
    const schema = { ...schema32 };
    schema.sample_fetches = undefined as never;
    schema.sample_converters = undefined as never;
    expect(
      validateSampleExpressions("http-request add-header n %[not_a_fetch]", schema as never),
    ).toEqual([expect.objectContaining({ code: "sample-unknown-fetch" })]);
  });
});

describe("validateSampleExpressions golden fixture", () => {
  it("matches documented errors in test-sample-fetch-args.cfg", () => {
    const content = readGoldenFixture("test-sample-fetch-args.cfg");
    const lines = content.split(/\r?\n/);
    const issues = lines.flatMap((line) => validateSampleExpressions(line, schema32));
    const codes = new Set(issues.map((d) => d.code));
    expect(codes).toContain("sample-missing-fetch");
    expect(codes).toContain("sample-unknown-fetch");
    expect(codes).toContain("sample-fetch-args");
  });
});
