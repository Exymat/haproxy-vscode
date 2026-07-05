import * as vscode from "vscode";

import { findInvalidNameChar, looksLikeListenAddress } from "./nameValidation";
import { makeError } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { HaproxySchema, symbolStringList } from "./schema";

export function sectionHeaderDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  if (!line.isSectionHeader || line.tokens.length < 2) {
    return [];
  }

  const section = line.tokens[0].text.toLowerCase();
  const diagnostics: vscode.Diagnostic[] = [];
  const namedSections = new Set(symbolStringList(schema, "named_sections"));
  const entrySections = new Set(symbolStringList(schema, "entry_point_sections"));

  if (namedSections.has(section)) {
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

  if (entrySections.has(section)) {
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
