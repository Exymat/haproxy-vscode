import { describe, expect, it } from "vitest";

import {
  applyDiagnosticSuppressions,
  diagnosticCodeText,
  ignoredDiagnosticCodesForLine,
  lineTextWithIgnoredDiagnosticCode,
} from "../../../src/diagnosticSuppressions";
import { makeDiagnostic } from "../../../src/diagnosticUtils";
import { parseDocumentLines } from "../../helpers/parse";
import * as vscode from "vscode";

function diagnostic(lineNo: number, code: string): vscode.Diagnostic {
  const [line] = parseDocumentLines(["    token"]);
  return makeDiagnostic(
    new vscode.Range(lineNo, line.tokens[0].start, lineNo, line.tokens[0].end),
    code,
    vscode.DiagnosticSeverity.Warning,
    code,
  );
}

describe("diagnostic suppressions", () => {
  it("formats VS Code diagnostic code variants", () => {
    expect(diagnosticCodeText(undefined)).toBeUndefined();
    expect(diagnosticCodeText("unknown-action")).toBe("unknown-action");
    expect(
      diagnosticCodeText({
        value: "unknown-keyword",
        target: vscode.Uri.parse("https://example.test"),
      }),
    ).toBe("unknown-keyword");
  });

  it("parses a single ignored diagnostic code", () => {
    expect(
      ignoredDiagnosticCodesForLine("http-request foo # haproxy: ignore=unknown-action"),
    ).toEqual(new Set(["unknown-action"]));
  });

  it("parses multiple ignored diagnostic codes with whitespace", () => {
    expect(
      ignoredDiagnosticCodesForLine(
        "http-request foo #   HAProxy : ignore = unknown-action, unknown-keyword ",
      ),
    ).toEqual(new Set(["unknown-action", "unknown-keyword"]));
  });

  it("ignores suppression markers inside quoted strings", () => {
    expect(
      ignoredDiagnosticCodesForLine('http-request set-header X "# haproxy: ignore=unknown-action"'),
    ).toEqual(new Set());
  });

  it("ignores unrelated or malformed comments", () => {
    expect(
      ignoredDiagnosticCodesForLine("http-request foo # haproxy: ignored=unknown-action"),
    ).toEqual(new Set());
    expect(ignoredDiagnosticCodesForLine("http-request foo # haproxy: ignore=")).toEqual(new Set());
    expect(ignoredDiagnosticCodesForLine("http-request foo # ordinary comment")).toEqual(new Set());
  });

  it("filters only diagnostics whose code is ignored on the same line", () => {
    const diagnostics = [
      diagnostic(0, "unknown-action"),
      diagnostic(0, "named-defaults-required"),
      diagnostic(1, "unknown-action"),
    ];
    expect(
      applyDiagnosticSuppressions(
        ["http-request foo # haproxy: ignore=unknown-action", "http-request foo"],
        diagnostics,
      ).map((diag) => diag.code),
    ).toEqual(["named-defaults-required", "unknown-action"]);
  });

  it("reuses parsed ignore-code sets for multiple diagnostics on one line", () => {
    const diagnostics = [
      diagnostic(0, "unknown-action"),
      diagnostic(0, "unknown-keyword"),
      diagnostic(0, "named-defaults-required"),
    ];
    expect(
      applyDiagnosticSuppressions(
        ["http-request foo # haproxy: ignore=unknown-action,unknown-keyword"],
        diagnostics,
      ).map((diag) => diag.code),
    ).toEqual(["named-defaults-required"]);
  });

  it("returns the original diagnostics array when no suppressions match", () => {
    const diagnostics = [diagnostic(0, "unknown-action")];
    expect(applyDiagnosticSuppressions(["http-request foo"], diagnostics)).toBe(diagnostics);
  });

  it("does not suppress diagnostics without usable codes or line text", () => {
    const withoutCode = diagnostic(0, "unknown-action");
    withoutCode.code = undefined;
    const outOfRange = diagnostic(5, "unknown-action");
    expect(
      applyDiagnosticSuppressions(
        ["http-request foo # haproxy: ignore=unknown-action"],
        [withoutCode, outOfRange],
      ),
    ).toEqual([withoutCode, outOfRange]);
  });

  it("builds line text for a new inline ignore comment", () => {
    expect(
      lineTextWithIgnoredDiagnosticCode("    http-request module-action", "UNKNOWN-ACTION"),
    ).toBe("    http-request module-action # haproxy: ignore=unknown-action");
  });

  it("extends an existing inline ignore comment", () => {
    expect(
      lineTextWithIgnoredDiagnosticCode(
        "    http-request module-action # haproxy: ignore=unknown-action",
        "unknown-keyword",
      ),
    ).toBe("    http-request module-action # haproxy: ignore=unknown-action,unknown-keyword");
  });

  it("preserves an existing ordinary comment when adding an inline ignore", () => {
    expect(
      lineTextWithIgnoredDiagnosticCode(
        "    http-request module-action # module hook",
        "unknown-action",
      ),
    ).toBe("    http-request module-action # haproxy: ignore=unknown-action module hook");
  });

  it("does not build line text for invalid or already ignored codes", () => {
    expect(
      lineTextWithIgnoredDiagnosticCode("    http-request module-action", "bad code"),
    ).toBeNull();
    expect(
      lineTextWithIgnoredDiagnosticCode(
        "    http-request module-action # haproxy: ignore=unknown-action",
        "unknown-action",
      ),
    ).toBeNull();
  });
});
