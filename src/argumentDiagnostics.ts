import * as vscode from "vscode";

import { enumNamesForSlot } from "./argumentEnumUtils";
import { argumentTokenIndices } from "./directiveUtils";
import { LineDiagnosticMemo } from "./diagnosticContext";
import { diagRange, DIAG_SOURCE } from "./diagnosticUtils";
import { ParsedLine } from "./parser";
import { ResolvedSchemaKeyword, resolveSchemaKeyword } from "./keywordVariant";
import {
  ArgumentModel,
  ArgumentSlot,
  conditionalTokenSet,
  HaproxySchema,
  prefixFamilies,
} from "./schema";
import { isLikelyValue } from "./tokenUtils";

const COOKIE_MODES = new Set([
  "indirect",
  "insert",
  "nocache",
  "prefix",
  "rewrite",
  "postonly",
  "preserve",
  "httponly",
  "secure",
  "domain",
  "attr",
]);

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

function formatEnumHint(values: string[]): string {
  if (values.length <= 6) {
    return values.join(", ");
  }
  return `${values.slice(0, 6).join(", ")}, ...`;
}

function isKeywordValuePair(
  slot: ArgumentSlot | undefined,
  nextSlot: ArgumentSlot | undefined,
): boolean {
  return Boolean(
    slot?.optional &&
    (slot.enum?.length ?? 0) > 0 &&
    nextSlot?.optional &&
    !(nextSlot.enum?.length ?? 0),
  );
}

function skipOptionalSlotGroup(model: ArgumentModel, slotIdx: number): number {
  const slot = model.slots[slotIdx];
  let next = slotIdx + 1;
  if (isKeywordValuePair(slot, model.slots[next])) {
    next += 1;
  }
  return next;
}

function matchesLaterEnumSlot(
  model: ArgumentModel,
  slotIdx: number,
  lower: string,
  schemaKw: ResolvedSchemaKeyword | undefined,
): boolean {
  for (let idx = slotIdx + 1; idx < model.slots.length; idx += 1) {
    const allowedValues = enumValuesForSlot(model.slots[idx], schemaKw, idx);
    if (allowedValues.length > 0 && new Set(allowedValues).has(lower)) {
      return true;
    }
  }
  return false;
}

type ArgDiagCode = "extra-argument" | "missing-argument" | "unknown-value";

function makeArgDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: ArgDiagCode,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, severity);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

function enumValuesForSlot(
  slot: ArgumentSlot | undefined,
  schemaKw: ResolvedSchemaKeyword | undefined,
  position: number,
): string[] {
  return enumNamesForSlot(slot, schemaKw, position).map((v) => v.toLowerCase());
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
            if (matchesLaterEnumSlot(model, slotIdx, lower, schemaKw)) {
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
        matchesLaterEnumSlot(model, slotIdx, lower, schemaKw)
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

function cookieArgumentDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  conditionals: Set<string>,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    diagnostics.push(
      makeArgDiagnostic(
        line,
        match.end,
        "'cookie' expects a cookie name",
        "missing-argument",
        vscode.DiagnosticSeverity.Error,
      ),
    );
    return diagnostics;
  }

  for (let pos = 1; pos < argIndices.length; pos += 1) {
    const tokenIdx = argIndices[pos];
    const value = line.tokens[tokenIdx].text.toLowerCase();
    if (!COOKIE_MODES.has(value) && !isLikelyValue(value, conditionals)) {
      diagnostics.push(
        makeArgDiagnostic(
          line,
          tokenIdx,
          `Unknown cookie modifier '${line.tokens[tokenIdx].text}'`,
          "unknown-value",
        ),
      );
    }
  }
  return diagnostics;
}

function balanceArgumentDiagnostics(
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
      makeArgDiagnostic(
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
        makeArgDiagnostic(
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
          makeArgDiagnostic(
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
          makeArgDiagnostic(
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
      makeArgDiagnostic(
        line,
        extra,
        `'balance' accepts at most ${model.max_args} argument(s)`,
        "extra-argument",
      ),
    );
  }
  return diagnostics;
}

function mysqlCheckOptionDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[],
  conditionals: Set<string>,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    return diagnostics;
  }
  const first = line.tokens[argIndices[0]].text.toLowerCase();
  if (first === "user") {
    if (argIndices.length < 2) {
      diagnostics.push(
        makeArgDiagnostic(
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
      if (mode !== "post-41" && mode !== "pre-41") {
        diagnostics.push(
          makeArgDiagnostic(
            line,
            modeIdx,
            `Unknown mysql-check mode '${line.tokens[modeIdx].text}' (expected: post-41, pre-41)`,
            "unknown-value",
          ),
        );
      }
    }
    return diagnostics;
  }

  const mode = first;
  if (mode !== "post-41" && mode !== "pre-41" && !isLikelyValue(mode, conditionals)) {
    diagnostics.push(
      makeArgDiagnostic(
        line,
        argIndices[0],
        `Unknown value '${line.tokens[argIndices[0]].text}' for 'option mysql-check' (expected: user, post-41, pre-41)`,
        "unknown-value",
      ),
    );
  }
  return diagnostics;
}

function httpSendNameHeaderDiagnostics(
  line: ParsedLine,
  argIndices: number[],
  version: string,
): vscode.Diagnostic[] {
  if (Number.parseFloat(version) < 3.4) {
    return [];
  }
  if (argIndices.length === 0) {
    return [];
  }
  const firstIdx = argIndices[0];
  const name = line.tokens[firstIdx].text;
  if (name.toLowerCase() !== "host") {
    return [];
  }
  return [
    makeArgDiagnostic(
      line,
      firstIdx,
      "'host' cannot be used for 'http-send-name-header'",
      "unknown-value",
      vscode.DiagnosticSeverity.Error,
    ),
  ];
}
