import * as vscode from "vscode";

import {
  isKeywordValuePair,
  matchesLaterEnumSlotInModel,
  skipOptionalSlotGroup,
} from "./argumentSlotValidation";
import {
  allowsMissingArgs,
  balanceArgumentDiagnostics,
  enumValuesForSlot,
  formatEnumHint,
} from "./argumentHandlers/balance";
import { cookieArgumentDiagnostics } from "./argumentHandlers/cookie";
import {
  httpSendNameHeaderDiagnostics,
  mysqlCheckOptionDiagnostics,
} from "./argumentHandlers/specialKeywords";
import { argumentTokenIndices, conditionalStartIndex } from "./directiveUtils";
import { LineDiagnosticMemo } from "./diagnosticContext";
import { makeLineDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { resolveSchemaKeyword } from "./keywordVariant";
import { conditionalTokenSet, HaproxySchema, prefixFamilySet } from "./schema";
import { isLikelyValue } from "./tokenUtils";

const SKIP_KEYWORDS = new Set([
  "bind",
  "server",
  "acl",
  "option",
  "stats",
  "http-request",
  "http-response",
  "tcp-request",
  "tcp-response",
  "http-after-response",
  "http-check",
  "tcp-check",
]);

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
  if (SKIP_KEYWORDS.has(keyword)) {
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

  if (keyword === "cookie") {
    const argIndices = argumentTokenIndices(line, match.end);
    return cookieArgumentDiagnostics(line, match, argIndices, getConditionals());
  }

  if (keyword === "balance") {
    if (!model || model.max_args === null || model.max_args === undefined) {
      return [];
    }
    const argIndices = argumentTokenIndices(line, match.end);
    return balanceArgumentDiagnostics(
      line,
      match,
      argIndices,
      model,
      schemaKw,
      schema,
      getConditionals(),
    );
  }

  if (keyword === "option mysql-check") {
    const argIndices = argumentTokenIndices(line, match.end);
    return mysqlCheckOptionDiagnostics(line, match, argIndices, getConditionals());
  }
  if (keyword === "http-send-name-header") {
    const argIndices = argumentTokenIndices(line, match.end);
    return httpSendNameHeaderDiagnostics(line, argIndices, schema.version);
  }

  if (!model || model.max_args === null || model.max_args === undefined) {
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

    while (slotIdx < model.slots.length) {
      const slot = model.slots[slotIdx];
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

      if (slotIdx >= model.max_args) {
        break;
      }

      placed = true;
      slotIdx += 1;
      break;
    }

    if (!placed) {
      diagnostics.push(
        makeArgDiagnostic(
          line,
          tokenIdx,
          `'${keyword}' accepts at most ${model.max_args} argument(s); '${value}' is unexpected`,
          "extra-argument",
        ),
      );
    }
  }

  return diagnostics;
}
