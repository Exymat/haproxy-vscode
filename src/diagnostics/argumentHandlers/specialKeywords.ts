import * as vscode from "vscode";

import { makeLineDiagnostic } from "../diagnosticUtils";
import { ParsedLine } from "../../parser";
import { HaproxySchema } from "../../schema/types";
import { validationRecord } from "../../schema/validation";
import { isLikelyValue } from "../../parser/tokenUtils";

function metadataError(path: string): Error {
  return new Error(`HAProxy schema is missing required generated metadata: ${path}`);
}

function specialArgumentRule(schema: HaproxySchema, keyword: string): Record<string, unknown> {
  const rules = validationRecord(schema, "special_argument_rules");
  const rule = rules[keyword];
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw metadataError(`validation_rules.special_argument_rules.${keyword}`);
  }
  return rule as Record<string, unknown>;
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw metadataError(path);
  }
  return value as string[];
}

export function mysqlCheckOptionDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  conditionals: Set<string>,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  void match;
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    return diagnostics;
  }
  const rule = specialArgumentRule(schema, "option mysql-check");
  const modes = stringList(
    rule.modes,
    "validation_rules.special_argument_rules.option mysql-check.modes",
  );
  const values = stringList(
    rule.values,
    "validation_rules.special_argument_rules.option mysql-check.values",
  );
  const modeSet = new Set(modes);
  const valueSet = new Set(values);
  const first = line.tokens[argIndices[0]].text.toLowerCase();
  if (first === "user") {
    if (argIndices.length < 2) {
      diagnostics.push(
        makeLineDiagnostic(
          line,
          argIndices[0],
          "option mysql-check user expects a username",
          "missing-argument",
          vscode.DiagnosticSeverity.Error,
        ),
      );
    }
    const modeIdx = argIndices.length >= 3 ? argIndices[2] : argIndices[1];
    if (argIndices.length >= 3) {
      const mode = line.tokens[modeIdx].text.toLowerCase();
      if (!modeSet.has(mode)) {
        diagnostics.push(
          makeLineDiagnostic(
            line,
            modeIdx,
            `Unknown mysql-check mode '${line.tokens[modeIdx].text}' (expected: ${modes.join(", ")})`,
            "unknown-value",
          ),
        );
      }
    }
    return diagnostics;
  }

  const mode = first;
  if (!valueSet.has(mode) && !isLikelyValue(mode, conditionals)) {
    diagnostics.push(
      makeLineDiagnostic(
        line,
        argIndices[0],
        `Unknown value '${line.tokens[argIndices[0]].text}' for 'option mysql-check' (expected: ${values.join(", ")})`,
        "unknown-value",
      ),
    );
  }
  return diagnostics;
}

export function httpSendNameHeaderDiagnostics(
  line: ParsedLine,
  argIndices: number[],
  version: string,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  if (Number.parseFloat(version) < 3.4) {
    return [];
  }
  if (argIndices.length === 0) {
    return [];
  }
  const firstIdx = argIndices[0];
  const name = line.tokens[firstIdx].text;
  const rule = specialArgumentRule(schema, "http-send-name-header");
  const byVersion =
    rule.forbidden_first_arg_by_min_version &&
    typeof rule.forbidden_first_arg_by_min_version === "object"
      ? (rule.forbidden_first_arg_by_min_version as Record<string, unknown>)
      : undefined;
  if (!byVersion) {
    throw metadataError(
      "validation_rules.special_argument_rules.http-send-name-header.forbidden_first_arg_by_min_version",
    );
  }
  const forbidden = Object.entries(byVersion).flatMap(([minVersion, values]) =>
    Number.parseFloat(version) >= Number.parseFloat(minVersion)
      ? stringList(
          values,
          `validation_rules.special_argument_rules.http-send-name-header.forbidden_first_arg_by_min_version.${minVersion}`,
        )
      : [],
  );
  if (!forbidden.includes(name.toLowerCase())) {
    return [];
  }
  return [
    makeLineDiagnostic(
      line,
      firstIdx,
      "'host' cannot be used for 'http-send-name-header'",
      "unknown-value",
      vscode.DiagnosticSeverity.Error,
    ),
  ];
}
