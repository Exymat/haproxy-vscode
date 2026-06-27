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
import { argumentTokenIndices } from "./directiveUtils";
import { LineDiagnosticMemo } from "./diagnosticContext";
import { makeLineDiagnostic } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { resolveSchemaKeyword } from "./keywordVariant";
import { conditionalTokenSet, HaproxySchema, prefixFamilies } from "./schema";
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
  if (prefixFamilies(schema).includes(keyword) || (t0 && prefixFamilies(schema).includes(t0))) {
    return [];
  }

  const fullKeyword = schema.keywords[keyword];
  const schemaKw = resolveSchemaKeyword(fullKeyword, line.section);
  const model = schemaKw?.argument_model;

  const argIndices = argumentTokenIndices(line, match.end);
  const conditionals = conditionalTokenSet(schema);
  const diagnostics: vscode.Diagnostic[] = [];

  if (keyword === "cookie") {
    return cookieArgumentDiagnostics(line, match, argIndices, conditionals);
  }

  if (keyword === "balance") {
    if (!model || model.max_args === null || model.max_args === undefined) {
      return [];
    }
    return balanceArgumentDiagnostics(
      line,
      match,
      argIndices,
      model,
      schemaKw,
      schema,
      conditionals,
    );
  }

  if (keyword === "option mysql-check") {
    return mysqlCheckOptionDiagnostics(line, match, argIndices, conditionals);
  }
  if (keyword === "http-send-name-header") {
    return httpSendNameHeaderDiagnostics(line, argIndices, schema.version);
  }

  if (!model || model.max_args === null || model.max_args === undefined) {
    return [];
  }

  if (
    argIndices.length < model.min_args &&
    !allowsMissingArgs(schemaKw, model, fullKeyword?.signatures)
  ) {
    const missing = model.min_args - argIndices.length;
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
  for (let pos = 0; pos < argIndices.length; pos += 1) {
    const tokenIdx = argIndices[pos];
    const value = line.tokens[tokenIdx].text;
    const lower = value.toLowerCase();
    const base = lower.split("(", 1)[0];
    let placed = false;

    while (slotIdx < model.slots.length) {
      const slot = model.slots[slotIdx];
      const allowedValues = enumValuesForSlot(slot, schemaKw, slotIdx);

      if (allowedValues.length > 0) {
        const allowedSet = new Set(allowedValues);
        const matches = allowedSet.has(lower) || allowedSet.has(base);
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
            if (!isLikelyValue(lower, conditionals)) {
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
          if (!isLikelyValue(lower, conditionals)) {
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
