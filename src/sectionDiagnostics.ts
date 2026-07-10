import * as vscode from "vscode";

import { findInvalidNameChar } from "./nameValidation";
import { makeError } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { DiagnosticContext } from "./diagnosticContext";
import { sectionHeaderFromModifier, sectionHeaderSupportsFromModifier } from "./sectionUtils";
import { HaproxySchema } from "./schema/types";

function defaultsSectionName(schema: HaproxySchema): string {
  if (typeof schema.symbols?.defaults_section_name === "string") {
    return schema.symbols.defaults_section_name.toLowerCase();
  }
  return "defaults";
}

function makeSectionExtraArgumentDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  sectionType: string,
  maxArgs: number,
  tokenText: string,
): vscode.Diagnostic {
  return makeError(
    line,
    tokenIndex,
    `'${sectionType}' accepts at most ${maxArgs} argument(s); '${tokenText}' is unexpected`,
    "extra-argument",
  );
}

function diagnoseFromCapableSectionHeader(
  line: ParsedLine,
  section: string,
  fromModifier: string,
  defaultsSection: string,
  diagnostics: vscode.Diagnostic[],
): vscode.Diagnostic[] {
  const isDefaultsFromProfile =
    section === defaultsSection && line.tokens[1].text.toLowerCase() === fromModifier;

  if (isDefaultsFromProfile) {
    for (let i = 3; i < line.tokens.length; i += 1) {
      diagnostics.push(
        makeSectionExtraArgumentDiagnostic(line, i, section, 1, line.tokens[i].text),
      );
    }
    return diagnostics;
  }

  if (line.tokens.length === 2) {
    return diagnostics;
  }

  const token2 = line.tokens[2];
  const token2Lower = token2.text.toLowerCase();

  if (token2Lower === fromModifier) {
    for (let i = 4; i < line.tokens.length; i += 1) {
      diagnostics.push(
        makeSectionExtraArgumentDiagnostic(line, i, section, 2, line.tokens[i].text),
      );
    }
    return diagnostics;
  }

  for (let i = 2; i < line.tokens.length; i += 1) {
    diagnostics.push(makeSectionExtraArgumentDiagnostic(line, i, section, 1, line.tokens[i].text));
  }
  return diagnostics;
}

export function sectionHeaderDiagnostics(
  line: ParsedLine,
  ctx: Pick<DiagnosticContext, "namedSections" | "schema">,
): vscode.Diagnostic[] {
  if (!line.isSectionHeader || line.tokens.length < 2) {
    return [];
  }

  const section = line.tokens[0].text.toLowerCase();
  const diagnostics: vscode.Diagnostic[] = [];
  const fromModifier = sectionHeaderFromModifier(ctx.schema);
  const defaultsSection = defaultsSectionName(ctx.schema);
  const isDefaultsFromProfile =
    section === defaultsSection && line.tokens[1].text.toLowerCase() === fromModifier;

  if (ctx.namedSections.has(section) && !isDefaultsFromProfile) {
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

  if (sectionHeaderSupportsFromModifier(ctx.schema, section)) {
    return diagnoseFromCapableSectionHeader(
      line,
      section,
      fromModifier,
      defaultsSection,
      diagnostics,
    );
  }

  for (let i = 2; i < line.tokens.length; i += 1) {
    diagnostics.push(makeSectionExtraArgumentDiagnostic(line, i, section, 1, line.tokens[i].text));
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
