import * as vscode from "vscode";

import { enumNamesForSlot } from "./argumentEnumUtils";
import { argumentTokenIndices } from "./directiveUtils";
import { ParsedLine } from "./parser";
import { HaproxySchema, SchemaKeyword } from "./schema";
import {
  isLikelyValue,
  PREFIX_FAMILIES,
  resolveLongestDirectiveMatch,
} from "./tokenUtils";

export interface ArgumentSlot {
  optional?: boolean;
  variadic?: boolean;
  enum?: string[];
}

export interface ArgumentModel {
  min_args: number;
  max_args: number | null;
  slots: ArgumentSlot[];
}

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

function diagRange(line: ParsedLine, tokenIndex: number): vscode.Range {
  const tok = line.tokens[tokenIndex];
  return new vscode.Range(line.line, tok.start, line.line, tok.end);
}

function formatEnumHint(values: string[]): string {
  if (values.length <= 6) {
    return values.join(", ");
  }
  return `${values.slice(0, 6).join(", ")}, ...`;
}

type ArgDiagCode = "extra-argument" | "missing-argument" | "unknown-value";

function makeArgDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: ArgDiagCode,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, severity);
  diagnostic.source = "haproxy";
  diagnostic.code = code;
  return diagnostic;
}

function enumValuesForSlot(
  slot: ArgumentSlot | undefined,
  schemaKw: SchemaKeyword | undefined,
  position: number
): string[] {
  return enumNamesForSlot(slot, schemaKw, position).map((v) => v.toLowerCase());
}

function allowsMissingArgs(schemaKw: SchemaKeyword | undefined, model: ArgumentModel): boolean {
  if (model.min_args === 0) {
    return true;
  }
  const signatures = schemaKw?.signatures ?? [];
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
  allowed: Set<string>,
  noPrefixKeywords?: Set<string>
): vscode.Diagnostic[] {
  const match = resolveLongestDirectiveMatch(line, allowed, 4, noPrefixKeywords);
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
  if (PREFIX_FAMILIES.includes(keyword) || (t0 && PREFIX_FAMILIES.includes(t0))) {
    return [];
  }

  const schemaKw = schema.keywords[keyword];
  const model = schemaKw?.argument_model as ArgumentModel | undefined;
  if (!model || model.max_args === null || model.max_args === undefined) {
    return [];
  }

  const argIndices = argumentTokenIndices(line, match.end);
  const diagnostics: vscode.Diagnostic[] = [];

  if (keyword === "cookie") {
    return cookieArgumentDiagnostics(line, match, argIndices);
  }

  if (keyword === "balance") {
    return balanceArgumentDiagnostics(line, match, argIndices, model, schemaKw);
  }

  if (keyword === "option mysql-check") {
    return mysqlCheckOptionDiagnostics(line, match, argIndices);
  }

  if (argIndices.length < model.min_args && !allowsMissingArgs(schemaKw, model)) {
    const missing = model.min_args - argIndices.length;
    diagnostics.push(
      makeArgDiagnostic(
        line,
        match.end,
        `'${keyword}' expects at least ${model.min_args} argument(s) (${missing} missing)`,
        "missing-argument",
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  for (let pos = 0; pos < argIndices.length; pos += 1) {
    const tokenIdx = argIndices[pos];
    const slot = model.slots[pos];
    const value = line.tokens[tokenIdx].text;
    const allowedValues = enumValuesForSlot(slot, schemaKw, pos);

    if (pos >= model.max_args) {
      diagnostics.push(
        makeArgDiagnostic(
          line,
          tokenIdx,
          `'${keyword}' accepts at most ${model.max_args} argument(s); '${value}' is unexpected`,
          "extra-argument"
        )
      );
      continue;
    }

    if (allowedValues.length === 0) {
      continue;
    }

    const lower = value.toLowerCase();
    const base = lower.split("(", 1)[0];
    if (isLikelyValue(lower)) {
      continue;
    }
    const allowedSet = new Set(allowedValues);
    if (!allowedSet.has(lower) && !allowedSet.has(base)) {
      diagnostics.push(
        makeArgDiagnostic(
          line,
          tokenIdx,
          `Unknown value '${value}' for '${keyword}' (expected: ${formatEnumHint(allowedValues)})`,
          "unknown-value"
        )
      );
    }
  }

  return diagnostics;
}

function cookieArgumentDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[]
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    diagnostics.push(
      makeArgDiagnostic(
        line,
        match.end,
        "'cookie' expects a cookie name",
        "missing-argument",
        vscode.DiagnosticSeverity.Error
      )
    );
    return diagnostics;
  }

  for (let pos = 1; pos < argIndices.length; pos += 1) {
    const tokenIdx = argIndices[pos];
    const value = line.tokens[tokenIdx].text.toLowerCase();
    if (!COOKIE_MODES.has(value) && !isLikelyValue(value)) {
      diagnostics.push(
        makeArgDiagnostic(
          line,
          tokenIdx,
          `Unknown cookie modifier '${line.tokens[tokenIdx].text}'`,
          "unknown-value"
        )
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
  schemaKw: SchemaKeyword | undefined
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (argIndices.length === 0) {
    return diagnostics;
  }

  const algorithmSlot = model.slots[0];
  const allowedAlgorithms = enumValuesForSlot(algorithmSlot, schemaKw, 0);
  const algoIdx = argIndices[0];
  const algo = line.tokens[algoIdx].text.toLowerCase();
  if (
    allowedAlgorithms.length > 0 &&
    !allowedAlgorithms.includes(algo) &&
    !isLikelyValue(algo)
  ) {
    diagnostics.push(
      makeArgDiagnostic(
        line,
        algoIdx,
        `Unknown balance algorithm '${line.tokens[algoIdx].text}' (expected: ${formatEnumHint(allowedAlgorithms)})`,
        "unknown-value"
      )
    );
  }

  if (argIndices.length > model.max_args!) {
    const extra = argIndices[model.max_args!];
    diagnostics.push(
      makeArgDiagnostic(
        line,
        extra,
        `'balance' accepts at most ${model.max_args} argument(s)`,
        "extra-argument"
      )
    );
  }
  return diagnostics;
}

function mysqlCheckOptionDiagnostics(
  line: ParsedLine,
  match: { end: number },
  argIndices: number[]
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
          vscode.DiagnosticSeverity.Error
        )
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
            "unknown-value"
          )
        );
      }
    }
    return diagnostics;
  }

  const mode = first;
  if (mode !== "post-41" && mode !== "pre-41" && !isLikelyValue(mode)) {
    diagnostics.push(
      makeArgDiagnostic(
        line,
        argIndices[0],
        `Unknown value '${line.tokens[argIndices[0]].text}' for 'option mysql-check' (expected: user, post-41, pre-41)`,
        "unknown-value"
      )
    );
  }
  return diagnostics;
}
