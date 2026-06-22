import { describe, expect, it } from "vitest";

import {
  filterExpressionIssuesAgainstDelimiters,
  validateLineDelimiters,
} from "../../src/delimiterDiagnostics";
import { sampleIssue } from "../../src/expressionTypes";
import { createDocument } from "../helpers/document";
import { defaultSchema, runDiagnostics } from "../helpers/diagnostics";

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
  });

  it("accepts balanced delimiters", () => {
    expect(
      validateLineDelimiters("    http-request set-header Host unless { req.hdr(Host) -m found }"),
    ).toEqual([]);
    expect(validateLineDelimiters("    http-request set-header x %[req.hdr(host)]")).toEqual([]);
  });
});

describe("filterExpressionIssuesAgainstDelimiters", () => {
  it("drops duplicate parenthesis errors when delimiter diagnostics already report them", () => {
    const expressionIssues = [
      sampleIssue(10, 11, "expected ')'", "sample-syntax"),
      sampleIssue(0, 3, "unknown fetch method 'bad'", "sample-unknown-fetch"),
    ];
    const delimiterIssues = validateLineDelimiters("    %[bad(]");
    const filtered = filterExpressionIssuesAgainstDelimiters(expressionIssues, delimiterIssues);
    expect(filtered).toEqual([expressionIssues[1]]);
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

  it("does not add duplicate expected ')' when delimiter diagnostics cover it", () => {
    const content = "frontend x\n    http-request set-header x %[req.hdr(host\n";
    const diagnostics = runDiagnostics(createDocument(content), defaultSchema);
    expect(diagnostics.some((diag) => diag.message === "expected ')'")).toBe(false);
    expect(diagnostics.some((diag) => diag.message === "missing closing ')'")).toBe(true);
  });
});
