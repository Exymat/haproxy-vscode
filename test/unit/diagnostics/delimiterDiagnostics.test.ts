import { describe, expect, it } from "vitest";

import {
  delimiterDiagnostics,
  filterExpressionIssuesAgainstDelimiters,
  validateLineDelimiters,
} from "../../../src/diagnostics/delimiterDiagnostics";
import { sampleIssue } from "../../../src/parser/expressionTypes";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { defaultSchema, runDiagnostics } from "../../helpers/diagnostics";

describe("validateLineDelimiters", () => {
  it("reports missing closing bracket on unclosed sample expressions", () => {
    const issues = validateLineDelimiters("    http-request set-header x-bad %[req.hdr(host)");
    expect(issues).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing ']'",
      }),
    ]);
  });

  it("reports missing closing brace on unclosed acl conditions", () => {
    const issues = validateLineDelimiters("    use_backend api if { path_beg /api");
    expect(issues).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing '}'",
      }),
    ]);
  });

  it("reports missing closing parenthesis", () => {
    const issues = validateLineDelimiters("    acl bad req.hdr(host");
    expect(issues).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing ')'",
      }),
    ]);
  });

  it("reports unexpected closing delimiters", () => {
    expect(validateLineDelimiters("    http-response add-header x-oops )")).toEqual([
      expect.objectContaining({
        code: "delimiter-unexpected",
        message: "unexpected ')'",
      }),
    ]);
    expect(validateLineDelimiters("    use_backend api if path_beg /api }")).toEqual([
      expect.objectContaining({
        code: "delimiter-unexpected",
        message: "unexpected '}'",
      }),
    ]);
    expect(validateLineDelimiters("    http-request deny if { always_true } extra }")).toEqual([
      expect.objectContaining({
        code: "delimiter-unexpected",
        message: "unexpected '}'",
      }),
    ]);
  });

  it("reports mismatched closers for mixed delimiter kinds", () => {
    expect(validateLineDelimiters("    acl x if { path_beg /api )")).toEqual([
      expect.objectContaining({
        code: "delimiter-unexpected",
        message: "unexpected ')'",
      }),
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing '}'",
      }),
    ]);
  });

  it("reports unclosed quoted strings", () => {
    expect(validateLineDelimiters('    description "hello')).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing '\"'",
      }),
    ]);
    expect(validateLineDelimiters("    description 'hello")).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing '''",
      }),
    ]);
  });

  it("ignores delimiters inside strings and comments", () => {
    expect(validateLineDelimiters('    acl x path "/api/{broken" if { always_true }')).toEqual([]);
    expect(validateLineDelimiters("    # comment with { unclosed")).toEqual([]);
    expect(validateLineDelimiters('    acl x hdr("it\'s fine") if { ok }')).toEqual([]);
    expect(validateLineDelimiters("    acl x hdr('say \"hi\"') if { ok }")).toEqual([]);
  });

  it("handles escaped characters inside double-quoted strings", () => {
    expect(validateLineDelimiters('    acl x path "foo\\nbar" if { ok }')).toEqual([]);
    expect(validateLineDelimiters('    acl x path "foo\\\\bar" if { ok }')).toEqual([]);
    expect(validateLineDelimiters('    acl x path "foo\\" if { ok }')).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing '\"'",
      }),
    ]);
    expect(validateLineDelimiters('    acl x path "trailing\\')).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing '\"'",
      }),
    ]);
    expect(validateLineDelimiters('    acl x path "unknown\\z" if { ok }')).toEqual([]);
  });

  it("reports unexpected closing brackets", () => {
    expect(validateLineDelimiters("    ]")).toEqual([
      expect.objectContaining({
        code: "delimiter-unexpected",
        message: "unexpected ']'",
      }),
    ]);
  });

  it("accepts balanced delimiters", () => {
    expect(
      validateLineDelimiters("    http-request set-header Host unless { req.hdr(Host) -m found }"),
    ).toEqual([]);
    expect(validateLineDelimiters("    http-request set-header x %[req.hdr(host)]")).toEqual([]);
  });

  it("accepts log-format flag blocks with bracketed sample expressions", () => {
    expect(
      validateLineDelimiters(
        "    http-request set-header ssl_client_cert_dn %{+Q}[ssl_c_s_dn] if { ssl_fc_has_crt }",
      ),
    ).toEqual([]);
    expect(
      validateLineDelimiters(
        "    http-request set-header ssl_client_cert_issuer %{+Q}[ssl_c_i_dn] if { ssl_fc_has_crt }",
      ),
    ).toEqual([]);
    expect(
      validateLineDelimiters("    http-request set-header X-SSL-Client-CN %{+Q}[ssl_c_s_dn(cn)]"),
    ).toEqual([]);
    expect(validateLineDelimiters("    http-request add-header name %{+Q}[hdr(arg))]")).toEqual([]);
    expect(validateLineDelimiters("    http-request set-header X-SSL %[ssl_fc]")).toEqual([]);
    expect(validateLineDelimiters("    http-request set-header X-SSL %(var)[ssl_fc]")).toEqual([]);
  });

  it("accepts escaped percent sequences", () => {
    expect(validateLineDelimiters("    %%")).toEqual([]);
  });

  it("reports unclosed parens in named log-format prefixes", () => {
    expect(validateLineDelimiters("    %(open")).toEqual([
      expect.objectContaining({
        code: "delimiter-unclosed",
        message: "missing closing ')'",
      }),
    ]);
  });

  it("ignores inner delimiters inside acl and sample expression regions", () => {
    expect(validateLineDelimiters("    http-request deny if { req.hdr( }")).toEqual([]);
    expect(validateLineDelimiters("    http-request add-header name %[req.hdr(]")).toEqual([]);
    expect(validateLineDelimiters("    http-request add-header name %[hdr(arg))]")).toEqual([]);
    expect(validateLineDelimiters("    http-request add-header name %[hdr(arg),ipmask(2]")).toEqual(
      [],
    );
  });
});

describe("filterExpressionIssuesAgainstDelimiters", () => {
  it("returns expression issues unchanged when delimiter issues are unrelated", () => {
    const expressionIssues = [sampleIssue(0, 3, "expected ')'", "sample-syntax")];
    expect(filterExpressionIssuesAgainstDelimiters(expressionIssues, [])).toEqual(expressionIssues);
    expect(
      filterExpressionIssuesAgainstDelimiters(expressionIssues, [
        {
          start: 0,
          end: 1,
          message: "unexpected ')'",
          code: "delimiter-unexpected",
          source: "haproxy",
        },
      ]),
    ).toEqual(expressionIssues);
  });

  it("drops duplicate parenthesis errors when delimiter diagnostics already report them", () => {
    const expressionIssues = [
      sampleIssue(10, 11, "expected ')'", "sample-syntax"),
      sampleIssue(0, 3, "unknown fetch method 'bad'", "sample-unknown-fetch"),
    ];
    const delimiterIssues = validateLineDelimiters("    %[bad(");
    const filtered = filterExpressionIssuesAgainstDelimiters(expressionIssues, delimiterIssues);
    expect(filtered).toEqual([expressionIssues[1]]);
  });

  it("drops duplicate unclosed quote errors when delimiter diagnostics already report them", () => {
    const expressionIssues = [
      sampleIssue(5, 10, "unclosed quote in argument", "sample-syntax"),
      sampleIssue(0, 3, "unknown fetch method 'bad'", "sample-unknown-fetch"),
    ];
    const filtered = filterExpressionIssuesAgainstDelimiters(
      expressionIssues,
      validateLineDelimiters('    http-request set-header x "open'),
    );
    expect(filtered).toEqual([expressionIssues[1]]);
  });

  it("drops duplicate single-quote errors when delimiter diagnostics already report them", () => {
    const expressionIssues = [
      sampleIssue(5, 10, "unclosed quote in argument", "sample-syntax"),
      sampleIssue(0, 3, "unknown fetch method 'bad'", "sample-unknown-fetch"),
    ];
    const filtered = filterExpressionIssuesAgainstDelimiters(
      expressionIssues,
      validateLineDelimiters("    http-request set-header x 'open"),
    );
    expect(filtered).toEqual([expressionIssues[1]]);
  });
});

describe("delimiterDiagnostics", () => {
  it("maps delimiter issues to VS Code diagnostics on the parsed line", () => {
    const doc = createDocument("frontend x\n    use_backend y if { path\n");
    const line = parseDocument(doc)[1];
    const issues = validateLineDelimiters(doc.lineAt(1).text);
    const diagnostics = delimiterDiagnostics(line, issues);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("missing closing '}'");
    expect(diagnostics[0].code).toBe("delimiter-unclosed");
    expect(diagnostics[0].range.start.line).toBe(1);
  });
});

describe("computeDiagnostics delimiter integration", () => {
  it("flags the large-mixed malformed sample expression line", () => {
    const content = [
      "frontend broken_expr_0000",
      "    http-request set-header x-bad %[req.hdr(host)",
    ].join("\n");
    const doc = createDocument(content);
    const diagnostics = runDiagnostics(doc, defaultSchema);
    expect(
      diagnostics.some(
        (diag) => diag.code === "delimiter-unclosed" && diag.message === "missing closing ']'",
      ),
    ).toBe(true);
    expect(diagnostics.some((diag) => diag.range.start.line === 1)).toBe(true);
  });

  it("does not flag log-format bracket expressions in set-header values", () => {
    const content = [
      "frontend x",
      "    http-request set-header ssl_client_cert_dn %{+Q}[ssl_c_s_dn] if { ssl_fc_has_crt }",
      "    http-request set-header ssl_client_cert_issuer %{+Q}[ssl_c_i_dn] if { ssl_fc_has_crt }",
    ].join("\n");
    const diagnostics = runDiagnostics(createDocument(content), defaultSchema);
    expect(diagnostics.some((diag) => diag.message === "unexpected ']'")).toBe(false);
    expect(diagnostics.some((diag) => diag.code === "delimiter-unexpected")).toBe(false);
  });

  it("does not add duplicate expected ')' when delimiter diagnostics cover it", () => {
    const content = "frontend x\n    http-request set-header x %[req.hdr(host\n";
    const diagnostics = runDiagnostics(createDocument(content), defaultSchema);
    expect(diagnostics.some((diag) => diag.message === "expected ')'")).toBe(false);
    expect(diagnostics.some((diag) => diag.message === "missing closing ']'")).toBe(true);
  });
});
