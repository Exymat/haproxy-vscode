import * as vscode from "vscode";

import { findInvalidNameChar, looksLikeListenAddress } from "./nameValidation";
import { makeError } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { DiagnosticContext } from "./diagnosticContext";

export function sectionHeaderDiagnostics(
  line: ParsedLine,
  ctx: Pick<DiagnosticContext, "namedSections" | "entryPointSections">,
): vscode.Diagnostic[] {
  if (!line.isSectionHeader || line.tokens.length < 2) {
    return [];
  }

  const section = line.tokens[0].text.toLowerCase();
  const diagnostics: vscode.Diagnostic[] = [];

  if (ctx.namedSections.has(section)) {
    const name = line.tokens[1].text;
    const bad = findInvalidNameChar(name);
    if (bad !== null) {
      diagnostics.push(
        makeError(
          line,
          1,
          `character '${bad}' is not permitted in '${section}' name '${name}'`,
          "invalid-name",
        ),
      );
    }
  }

  if (ctx.entryPointSections.has(section)) {
    for (let i = 2; i < line.tokens.length; i += 1) {
      const tok = line.tokens[i].text.toLowerCase();
      if (tok === "from") {
        return diagnostics;
      }
      if (looksLikeListenAddress(line.tokens[i].text)) {
        diagnostics.push(
          makeError(
            line,
            i,
            "please use the 'bind' keyword for listening addresses",
            "legacy-bind-syntax",
          ),
        );
        return diagnostics;
      }
    }
  }

  return diagnostics;
}

export function aclNameDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  if (line.tokens[0]?.text.toLowerCase() !== "acl" || line.tokens.length < 3) {
    return [];
  }
  const name = line.tokens[1].text;
  const bad = findInvalidNameChar(name);
  if (bad === null) {
    return [];
  }
  return [
    makeError(line, 1, `character '${bad}' is not permitted in acl name '${name}'`, "invalid-name"),
  ];
}
