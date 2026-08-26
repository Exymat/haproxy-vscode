/** Validates directive arguments against schema argument models. */

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
import { resolveSchemaKeyword, ResolvedSchemaKeyword } from "../language/keywordVariant";
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

function shouldSkipArgumentModel(
  line: ParsedLine,
  schema: HaproxySchema,
  memo: LineDiagnosticMemo,
  noPrefixKeywords?: Set<string>,
): boolean {
  const match = memo.directiveMatch;
  if (!match.matched) {
    return true;
  }
  const keyword = match.keyword.toLowerCase();
  if (argumentModelSkipKeywordSet(schema).has(keyword)) {
    return true;
  }
  const t0 = line.tokens[0]?.text.toLowerCase();
  if (t0 === "no" || t0 === "default") {
    const base = match.keyword.toLowerCase();
    if (line.tokens[1]?.text.toLowerCase() === "option" || noPrefixKeywords?.has(base)) {
      return true;
    }
  }
  const prefixFamilies = prefixFamilySet(schema);
  return prefixFamilies.has(keyword) || Boolean(t0 && prefixFamilies.has(t0));
}

function pushUnknownValue(
  diagnostics: vscode.Diagnostic[],
  line: ParsedLine,
  tokenIdx: number,
  value: string,
  keyword: string,
  allowedValues: string[],
  lower: string,
  getConditionals: () => Set<string>,
): void {
  if (isLikelyValue(lower, getConditionals())) {
    return;
  }
  diagnostics.push(
    makeArgDiagnostic(
      line,
      tokenIdx,
      `Unknown value '${value}' for '${keyword}' (expected: ${formatEnumHint(allowedValues)})`,
      "unknown-value",
    ),
  );
}

function placeArgumentToken(args: {
  model: NonNullable<ResolvedSchemaKeyword["argument_model"]>;
  schemaKw: ResolvedSchemaKeyword | undefined;
  slotIdx: number;
  lower: string;
  value: string;
  keyword: string;
  line: ParsedLine;
  tokenIdx: number;
  getConditionals: () => Set<string>;
  diagnostics: vscode.Diagnostic[];
}): { slotIdx: number; placed: boolean } {
  const { model, schemaKw, lower, value, keyword, line, tokenIdx, getConditionals, diagnostics } =
    args;
  let { slotIdx } = args;
  const base = lower.split("(", 1)[0];

  while (true) {
    const slot = slotForPosition(model, slotIdx);
    if (!slot) {
      return { slotIdx, placed: false };
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
          pushUnknownValue(
            diagnostics,
            line,
            tokenIdx,
            value,
            keyword,
            allowedValues,
            lower,
            getConditionals,
          );
          return { slotIdx: slotIdx + 1, placed: true };
        }
        pushUnknownValue(
          diagnostics,
          line,
          tokenIdx,
          value,
          keyword,
          allowedValues,
          lower,
          getConditionals,
        );
        return { slotIdx: slotIdx + 1, placed: true };
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
      return { slotIdx, placed: false };
    }

    return { slotIdx: slotIdx + 1, placed: true };
  }
}

export function argumentModelDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
  memo: LineDiagnosticMemo,
  noPrefixKeywords?: Set<string>,
): vscode.Diagnostic[] {
  if (shouldSkipArgumentModel(line, schema, memo, noPrefixKeywords)) {
    return [];
  }

  const match = memo.directiveMatch;
  const keyword = match.keyword.toLowerCase();
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
    const placed = placeArgumentToken({
      model,
      schemaKw,
      slotIdx,
      lower: value.toLowerCase(),
      value,
      keyword,
      line,
      tokenIdx,
      getConditionals,
      diagnostics,
    });
    slotIdx = placed.slotIdx;
    if (!placed.placed) {
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
