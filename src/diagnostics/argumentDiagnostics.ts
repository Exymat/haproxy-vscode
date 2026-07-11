import * as vscode from "vscode";

import {
  hasArgumentModelValidation,
  isKeywordValuePair,
  matchesLaterEnumSlotInModel,
  skipOptionalSlotGroup,
  slotForPosition,
} from "./argumentSlotValidation";
import { allowsMissingArgs, enumValuesForSlot, formatEnumHint } from "./argumentHandlers/balance";
import { runSpecialArgumentHandlers } from "./argumentHandlers/registry";
import { conditionalStartIndex } from "../language/directiveUtils";
import { LineDiagnosticMemo } from "./diagnosticContext";
import { makeLineDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "../parser";
import { resolveSchemaKeyword } from "../language/keywordVariant";
import { HaproxySchema } from "../schema/types";
import { prefixFamilySet } from "../schema/layout";
import { conditionalTokenSet } from "../schema/tokens";
import { isLikelyValue } from "../parser/tokenUtils";

import { argumentModelSkipKeywordSet } from "./diagnosticKeywordSets";

function makeArgDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: "extra-argument" | "missing-argument" | "unknown-value",
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning,
): vscode.Diagnostic {
  return makeLineDiagnostic(line, tokenIndex, message, code, severity);
}

export function argumentModelDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
  memo: LineDiagnosticMemo,
  noPrefixKeywords?: Set<string>,
): vscode.Diagnostic[] {
  const match = memo.directiveMatch;
  if (!match.matched) {
    return [];
  }

  const keyword = match.keyword.toLowerCase();
  if (argumentModelSkipKeywordSet(schema).has(keyword)) {
    return [];
  }

  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 === "no" || t0 === "default") {
    const base = match.keyword.toLowerCase();
    if (line.tokens[1]?.text.toLowerCase() === "option" || noPrefixKeywords?.has(base)) {
      return [];
    }
  }
  const prefixFamilies = prefixFamilySet(schema);
  if (prefixFamilies.has(keyword) || (t0 && prefixFamilies.has(t0))) {
    return [];
  }

  const fullKeyword = schema.keywords[keyword];
  const schemaKw = resolveSchemaKeyword(fullKeyword, line.section);
  const model = schemaKw?.argument_model;
  const diagnostics: vscode.Diagnostic[] = [];
  let conditionals: Set<string> | undefined;
  const getConditionals = (): Set<string> => {
    conditionals ??= conditionalTokenSet(schema);
    return conditionals;
  };
  const argsEnd = conditionalStartIndex(line, match.end);

  const specialResult = runSpecialArgumentHandlers({
    line,
    schema,
    match,
    memo,
    fullKeyword,
    schemaKw,
    getConditionals,
  });
  if (specialResult !== null) {
    return specialResult;
  }

  if (!hasArgumentModelValidation(model)) {
    return [];
  }

  if (
    argsEnd - match.end - 1 < model.min_args &&
    !allowsMissingArgs(schemaKw, model, fullKeyword?.signatures)
  ) {
    const missing = model.min_args - (argsEnd - match.end - 1);
    diagnostics.push(
      makeArgDiagnostic(
        line,
        match.end,
        `'${keyword}' expects at least ${model.min_args} argument(s) (${missing} missing)`,
        "missing-argument",
        vscode.DiagnosticSeverity.Error,
      ),
    );
  }

  let slotIdx = 0;
  for (let tokenIdx = match.end + 1; tokenIdx < argsEnd; tokenIdx += 1) {
    const value = line.tokens[tokenIdx].text;
    const lower = value.toLowerCase();
    const base = lower.split("(", 1)[0];
    let placed = false;

    while (true) {
      const slot = slotForPosition(model, slotIdx);
      if (!slot) {
        break;
      }
      const allowedValues = enumValuesForSlot(slot, schemaKw, slotIdx);

      if (allowedValues.length > 0) {
        const matches = allowedValues.includes(lower) || allowedValues.includes(base);
        if (!matches) {
          if (slot.optional) {
            if (isKeywordValuePair(slot, model.slots[slotIdx + 1])) {
              slotIdx = skipOptionalSlotGroup(model, slotIdx);
              continue;
            }
            if (matchesLaterEnumSlotInModel(model, slotIdx, lower, schemaKw)) {
              slotIdx += 1;
              continue;
            }
            if (!isLikelyValue(lower, getConditionals())) {
              diagnostics.push(
                makeArgDiagnostic(
                  line,
                  tokenIdx,
                  `Unknown value '${value}' for '${keyword}' (expected: ${formatEnumHint(allowedValues)})`,
                  "unknown-value",
                ),
              );
            }
            placed = true;
            slotIdx += 1;
            break;
          }
          if (!isLikelyValue(lower, getConditionals())) {
            diagnostics.push(
              makeArgDiagnostic(
                line,
                tokenIdx,
                `Unknown value '${value}' for '${keyword}' (expected: ${formatEnumHint(allowedValues)})`,
                "unknown-value",
              ),
            );
          }
          placed = true;
          slotIdx += 1;
          break;
        }
      }

      if (
        slot.optional &&
        allowedValues.length === 0 &&
        matchesLaterEnumSlotInModel(model, slotIdx, lower, schemaKw)
      ) {
        slotIdx += 1;
        continue;
      }

      if (model.max_args !== null && model.max_args !== undefined && slotIdx >= model.max_args) {
        break;
      }

      placed = true;
      slotIdx += 1;
      break;
    }

    if (!placed) {
      const maxHint =
        model.max_args !== null && model.max_args !== undefined
          ? String(model.max_args)
          : String(model.slots.length);
      diagnostics.push(
        makeArgDiagnostic(
          line,
          tokenIdx,
          `'${keyword}' accepts at most ${maxHint} argument(s); '${value}' is unexpected`,
          "extra-argument",
        ),
      );
    }
  }

  return diagnostics;
}
