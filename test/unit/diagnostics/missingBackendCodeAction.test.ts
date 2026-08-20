import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { provideMissingBackendStubCodeActions } from "../../../src/diagnostics/missingBackendCodeAction";
import { createDocument } from "../../helpers/document";
import { Diagnostic, DiagnosticSeverity, Range } from "../../helpers/vscode";

describe("missingBackendCodeAction", () => {
  it("creates a missing backend stub quick fix", () => {
    const doc = createDocument("frontend web\n    use_backend missing");
    const diagnostic = new Diagnostic(
      new Range(1, 16, 1, 23),
      "Proxy section 'missing' is referenced but not defined in this file",
      DiagnosticSeverity.Warning,
    );
    diagnostic.source = "haproxy";
    diagnostic.code = "missing-reference";

    const actions = provideMissingBackendStubCodeActions(doc, {
      diagnostics: [diagnostic],
    } as unknown as vscode.CodeActionContext);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toContain("missing");
    const edit = actions[0]?.edit as { insertions?: Array<{ newText: string }> } | undefined;
    expect(edit?.insertions?.[0]?.newText).toContain("backend missing");
  });

  it("ignores non-matching diagnostics and deduplicates backend names", () => {
    const doc = createDocument("frontend web\n    use_backend missing\n");
    const wrongSource = new Diagnostic(
      new Range(1, 16, 1, 23),
      "Proxy section 'missing' is referenced but not defined in this file",
      DiagnosticSeverity.Warning,
    );
    wrongSource.source = "other";
    wrongSource.code = "missing-reference";

    const wrongCode = new Diagnostic(
      new Range(1, 16, 1, 23),
      "something else",
      DiagnosticSeverity.Warning,
    );
    wrongCode.source = "haproxy";
    wrongCode.code = "unknown-keyword";

    const notBackendLine = new Diagnostic(
      new Range(0, 9, 0, 12),
      "Proxy section 'web' is referenced but not defined in this file",
      DiagnosticSeverity.Warning,
    );
    notBackendLine.source = "haproxy";
    notBackendLine.code = "missing-reference";

    const valid = new Diagnostic(
      new Range(1, 16, 1, 23),
      "Proxy section 'missing' is referenced but not defined in this file",
      DiagnosticSeverity.Warning,
    );
    valid.source = "haproxy";
    valid.code = "missing-reference";

    const actions = provideMissingBackendStubCodeActions(doc, {
      diagnostics: [wrongSource, wrongCode, notBackendLine, valid, valid],
    } as unknown as vscode.CodeActionContext);
    expect(actions).toHaveLength(1);

    const blankEnded = createDocument("frontend web\n    use_backend missing\n\n");
    expect(
      provideMissingBackendStubCodeActions(blankEnded, {
        diagnostics: [valid],
      } as unknown as vscode.CodeActionContext),
    ).toHaveLength(1);

    const noTrailingNewline = createDocument("frontend web\n    use_backend missing");
    expect(
      provideMissingBackendStubCodeActions(noTrailingNewline, {
        diagnostics: [valid],
      } as unknown as vscode.CodeActionContext),
    ).toHaveLength(1);
  });

  it("does not create a backend for a missing ACL on a use_backend line", () => {
    const line = "    use_backend api if missing_acl";
    const start = line.indexOf("missing_acl");
    const diagnostic = new Diagnostic(
      new Range(1, start, 1, start + "missing_acl".length),
      "ACL 'missing_acl' is referenced but not defined",
      DiagnosticSeverity.Warning,
    );
    diagnostic.source = "haproxy";
    diagnostic.code = "missing-reference";
    expect(
      provideMissingBackendStubCodeActions(createDocument(`frontend web\n${line}`), {
        diagnostics: [diagnostic],
      } as unknown as vscode.CodeActionContext),
    ).toEqual([]);
  });
});
