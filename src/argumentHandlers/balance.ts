import * as vscode from "vscode";

import { enumNamesForSlotLower } from "../argumentEnumUtils";
import { makeLineDiagnostic } from "../diagnosticUtils";
import { ResolvedSchemaKeyword } from "../keywordVariant";
import { ArgumentModel, HaproxySchema } from "../schema";
import { ParsedLine } from "../parser";
import { isLikelyValue } from "../tokenUtils";

function formatEnumHint(values: string[]): string {
  if (values.length <= 6) {
    return values.join(", ");
  }
  return `${values.slice(0, 6).join(", ")}, ...`;
}

function enumValuesForSlot(
  slot: import("../schema").ArgumentSlot | undefined,
  schemaKw: ResolvedSchemaKeyword | undefined,
  position: number,
): string[] {
  return enumNamesForSlotLower(slot, schemaKw, position);
}

function allowsMissingArgs(
  schemaKw: ResolvedSchemaKeyword | undefined,
  model: ArgumentModel,
  allSignatures: string[] | undefined,
): boolean {
  const signatures = allSignatures ?? schemaKw?.signatures ?? [];
  if (signatures.length > 1) {
    return true;
  }
  if (model.slots.some((slot) => slot.optional)) {
    return true;
  }
  return false;
}

export function balanceArgumentDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  model: ArgumentModel,
  schemaKw: ResolvedSchemaKeyword | undefined,
  schema: HaproxySchema,
  conditionals: Set<string>,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    return diagnostics;
  }

  const algorithmSlot = model.slots[0];
  const allowedAlgorithms = enumValuesForSlot(algorithmSlot, schemaKw, 0);
  const algoIdx = argIndices[0];
  const algo = line.tokens[algoIdx].text.toLowerCase();
  const algoBase = algo.split("(", 1)[0];
  if (
    allowedAlgorithms.length > 0 &&
    !allowedAlgorithms.includes(algo) &&
    !allowedAlgorithms.includes(algoBase) &&
    !isLikelyValue(algo, conditionals)
  ) {
    diagnostics.push(
      makeLineDiagnostic(
        line,
        algoIdx,
        `Unknown balance algorithm '${line.tokens[algoIdx].text}' (expected: ${formatEnumHint(allowedAlgorithms)})`,
        "unknown-value",
      ),
    );
  }

  if (algoBase === "url_param") {
    const variant = schema.keywords["balance url_param"];
    const variantModel = variant?.argument_model;
    if (!variantModel || variantModel.max_args === null || variantModel.max_args === undefined) {
      return diagnostics;
    }
    const variantArgs = argIndices.slice(1);
    if (
      variantArgs.length < variantModel.min_args &&
      !allowsMissingArgs(variant, variantModel, variant?.signatures)
    ) {
      const missing = variantModel.min_args - variantArgs.length;
      diagnostics.push(
        makeLineDiagnostic(
          line,
          algoIdx,
          `'balance url_param' expects at least ${variantModel.min_args} argument(s) (${missing} missing)`,
          "missing-argument",
          vscode.DiagnosticSeverity.Error,
        ),
      );
      return diagnostics;
    }
    for (let pos = 0; pos < variantArgs.length; pos += 1) {
      const tokenIdx = variantArgs[pos];
      const slot = variantModel.slots[pos];
      const value = line.tokens[tokenIdx].text;
      const allowedValues = enumValuesForSlot(slot, variant, pos);
      if (variantModel.max_args !== null && pos >= variantModel.max_args) {
        diagnostics.push(
          makeLineDiagnostic(
            line,
            tokenIdx,
            `'balance url_param' accepts at most ${variantModel.max_args} argument(s); '${value}' is unexpected`,
            "extra-argument",
          ),
        );
        continue;
      }
      if (allowedValues.length === 0) {
        continue;
      }
      const lower = value.toLowerCase();
      const base = lower.split("(", 1)[0];
      if (isLikelyValue(lower, conditionals)) {
        continue;
      }
      const allowedSet = new Set(allowedValues);
      if (!allowedSet.has(lower) && !allowedSet.has(base)) {
        diagnostics.push(
          makeLineDiagnostic(
            line,
            tokenIdx,
            `Unknown value '${value}' for 'balance url_param' (expected: ${formatEnumHint(allowedValues)})`,
            "unknown-value",
          ),
        );
      }
    }
    return diagnostics;
  }

  if (argIndices.length > model.max_args!) {
    const extra = argIndices[model.max_args!];
    diagnostics.push(
      makeLineDiagnostic(
        line,
        extra,
        `'balance' accepts at most ${model.max_args} argument(s)`,
        "extra-argument",
      ),
    );
  }
  return diagnostics;
}

// re-export for generic walker slot skipping
export { formatEnumHint, enumValuesForSlot, allowsMissingArgs };
