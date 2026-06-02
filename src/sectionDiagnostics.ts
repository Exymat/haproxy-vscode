import * as vscode from "vscode";

import { findInvalidNameChar, looksLikeListenAddress } from "./nameValidation";
import { ParsedLine } from "./parser";

const DIAG_SOURCE = "haproxy";

const NAMED_SECTIONS = new Set(["frontend", "backend", "listen", "defaults", "peers", "userlist"]);

function diagRange(line: ParsedLine, tokenIndex: number): vscode.Range {
  const tok = line.tokens[tokenIndex];
  return new vscode.Range(line.line, tok.start, line.line, tok.end);
}

function makeError(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: string
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

export function sectionHeaderDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  if (!line.isSectionHeader || line.tokens.length < 2) {
    return [];
  }

  const section = line.tokens[0].text.toLowerCase();
  const diagnostics: vscode.Diagnostic[] = [];

  if (NAMED_SECTIONS.has(section)) {
    const name = line.tokens[1].text;
    const bad = findInvalidNameChar(name);
    if (bad !== null) {
      diagnostics.push(
        makeError(
          line,
          1,
          `character '${bad}' is not permitted in '${section}' name '${name}'`,
          "invalid-name"
        )
      );
    }
  }

  if (section === "frontend" || section === "listen") {
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
            "legacy-bind-syntax"
          )
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
    makeError(
      line,
      1,
      `character '${bad}' is not permitted in acl name '${name}'`,
      "invalid-name"
    ),
  ];
}
