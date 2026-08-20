import * as vscode from "vscode";

import { deprecatedDiagnostics } from "../../../src/diagnostics/deprecatedDiagnostics";
import { DiagnosticContext, LineDiagnosticMemo } from "../../../src/diagnostics/diagnosticContext";
import { buildDeprecatedIndex } from "../../../src/language/deprecatedIndex";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

describe("deprecatedDiagnostics", () => {
  it("tags deprecated diagnostics with DiagnosticTag.Deprecated", () => {
    const deprecatedKeyword = Object.keys(schema.keywords).find((name) =>
      buildDeprecatedIndex(schema).keywords.has(name),
    );
    expect(deprecatedKeyword).toBeDefined();
    if (!deprecatedKeyword) {
      return;
    }

    const line = {
      line: 0,
      tokens: [
        { text: deprecatedKeyword, start: 0, end: deprecatedKeyword.length },
        { text: "value", start: deprecatedKeyword.length + 1, end: deprecatedKeyword.length + 6 },
      ],
      section: "global",
      isSectionHeader: false,
      anonymousDefaults: false,
    };
    const memo = {
      directiveMatch: {
        keyword: deprecatedKeyword,
        start: 0,
        end: 0,
        matched: true,
      },
      statementRule: undefined,
    } as LineDiagnosticMemo;
    const ctx = { schema } as DiagnosticContext;
    const index = buildDeprecatedIndex(schema);
    const diagnostics = deprecatedDiagnostics(ctx, line, memo, index, false);
    expect(diagnostics[0]?.tags).toEqual([vscode.DiagnosticTag.Deprecated]);
  });
});
