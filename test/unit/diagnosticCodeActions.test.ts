import { describe, expect, it } from "vitest";

import { provideDiagnosticSuppressionCodeActions } from "../../src/diagnosticCodeActions";
import { makeDiagnostic } from "../../src/diagnosticUtils";
import { createDocument } from "../helpers/document";
import * as vscode from "vscode";

function diagnostic(line: number, code: string): vscode.Diagnostic {
  return makeDiagnostic(
    new vscode.Range(line, 4, line, 16),
    `diagnostic ${code}`,
    vscode.DiagnosticSeverity.Warning,
    code,
  );
}

describe("diagnostic code actions", () => {
  it("adds a quick fix that appends an inline ignore comment", () => {
    const document = createDocument("frontend web\n    http-request module-action if TRUE");
    const actions = provideDiagnosticSuppressionCodeActions(document, {
      diagnostics: [diagnostic(1, "unknown-action")],
      only: undefined,
      triggerKind: 1,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("Ignore HAProxy diagnostic 'unknown-action' on this line");
    expect(actions[0]?.kind).toBe(vscode.CodeActionKind.QuickFix);
    expect((actions[0]?.edit as unknown as { edits: unknown[] }).edits).toEqual([
      {
        uri: document.uri,
        range: new vscode.Range(1, 0, 1, "    http-request module-action if TRUE".length),
        newText: "    http-request module-action if TRUE # haproxy: ignore=unknown-action",
      },
    ]);
  });

  it("extends an existing inline ignore comment", () => {
    const document = createDocument(
      "frontend web\n    module-keyword # haproxy: ignore=unknown-action",
    );
    const actions = provideDiagnosticSuppressionCodeActions(document, {
      diagnostics: [diagnostic(1, "unknown-keyword")],
      only: undefined,
      triggerKind: 1,
    });

    expect(
      (actions[0]?.edit as unknown as { edits: Array<{ newText: string }> }).edits[0]?.newText,
    ).toBe("    module-keyword # haproxy: ignore=unknown-action,unknown-keyword");
  });

  it("skips diagnostics with no code", () => {
    const document = createDocument("frontend web\n    http-request module-action if TRUE");
    const withoutCode = diagnostic(1, "unknown-action");
    withoutCode.code = undefined;
    const actions = provideDiagnosticSuppressionCodeActions(document, {
      diagnostics: [withoutCode],
      only: undefined,
      triggerKind: 1,
    });

    expect(actions).toEqual([]);
  });

  it("deduplicates diagnostics with the same line and code", () => {
    const document = createDocument("frontend web\n    http-request module-action if TRUE");
    const actions = provideDiagnosticSuppressionCodeActions(document, {
      diagnostics: [diagnostic(1, "unknown-action"), diagnostic(1, "unknown-action")],
      only: undefined,
      triggerKind: 1,
    });

    expect(actions).toHaveLength(1);
  });

  it("skips diagnostics that are already ignored on the line", () => {
    const document = createDocument(
      "frontend web\n    http-request module-action if TRUE # haproxy: ignore=unknown-action",
    );
    const actions = provideDiagnosticSuppressionCodeActions(document, {
      diagnostics: [diagnostic(1, "unknown-action")],
      only: undefined,
      triggerKind: 1,
    });

    expect(actions).toEqual([]);
  });

  it("skips non-HAProxy diagnostics", () => {
    const document = createDocument("frontend web\n    http-request module-action if TRUE");
    const other = diagnostic(1, "unknown-action");
    other.source = "other";
    const actions = provideDiagnosticSuppressionCodeActions(document, {
      diagnostics: [other],
      only: undefined,
      triggerKind: 1,
    });

    expect(actions).toEqual([]);
  });
});
