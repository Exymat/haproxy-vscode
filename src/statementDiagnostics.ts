import * as vscode from "vscode";

import { enumNamesForSlot } from "./argumentEnumUtils";
import {
  ADDRESS_POLICIES,
  AddressPolicyName,
  AddressValidationResult,
  isServerMainAddressPlaceholder,
  PortAddressPolicy,
  validateHaproxyAddress,
} from "./addressFormat";
import { conditionalStartIndex } from "./directiveUtils";
import { diagRange, DIAG_SOURCE } from "./diagnosticUtils";
import { resolveLineOptionStartIndex } from "./hover/lineOptions";
import { ParsedLine } from "./parser";
import { FixedSlotSpec, HaproxySchema, optionsWithValueSet, StatementRule } from "./schema";
import { ResolvedSchemaKeyword, resolveSchemaKeyword } from "./keywordVariant";
import { findStatementRule } from "./statementLayout";

type StmtDiagCode =
  | "invalid-address"
  | "missing-port"
  | "port-not-permitted"
  | "port-range-not-permitted"
  | "port-offset-not-permitted"
  | "invalid-port"
  | "missing-argument"
  | "unexpected-argument"
  | "unknown-parameter"
  | "reserved-name";

const SERVER_ADDRESS_OPTION_POLICIES: Record<string, AddressPolicyName> = {
  source: "serverSource",
  usesrc: "serverUsesrc",
  socks4: "serverSocks4",
};

function makeDiagnostic(
  line: ParsedLine,
  tokenIndex: number,
  message: string,
  code: StmtDiagCode,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, severity);
  diagnostic.source = DIAG_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

function pushAddressResult(
  line: ParsedLine,
  tokenIndex: number,
  result: AddressValidationResult,
  diagnostics: vscode.Diagnostic[],
): void {
  if (result.valid || !result.message) {
    return;
  }
  const code = (result.code ?? "invalid-address") as StmtDiagCode;
  diagnostics.push(makeDiagnostic(line, tokenIndex, result.message, code));
}

function policyForSlot(rule: StatementRule, spec: FixedSlotSpec, token: string): PortAddressPolicy {
  if (spec.address_policy && spec.address_policy in ADDRESS_POLICIES) {
    const named = spec.address_policy as AddressPolicyName;
    if (named === "bind" && token.startsWith("/")) {
      return { ...ADDRESS_POLICIES.bind, portMandatory: false };
    }
    return ADDRESS_POLICIES[named];
  }
  if (rule.kind === "bind") {
    return token.startsWith("/")
      ? { ...ADDRESS_POLICIES.bind, portMandatory: false }
      : ADDRESS_POLICIES.bind;
  }
  return ADDRESS_POLICIES.server;
}

function validateFixedSlots(line: ParsedLine, rule: StatementRule): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const slots = rule.fixed_slots ?? [];
  const nestedStart = resolveLineOptionStartIndex(line, rule);
  const condStart = conditionalStartIndex(line, 0);
  const limit = Math.min(condStart, nestedStart >= 0 ? nestedStart : 1 + slots.length);

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
    const tokenIdx = 1 + slotIdx;
    if (tokenIdx >= limit) {
      diagnostics.push(
        makeDiagnostic(
          line,
          Math.max(1, line.tokens.length - 1),
          `'${rule.keyword}' is missing required argument`,
          "missing-argument",
        ),
      );
      break;
    }

    const token = line.tokens[tokenIdx].text;
    const spec = slots[slotIdx];

    if (spec.role === "name") {
      const lower = token.toLowerCase();
      if (lower === "check" || lower === "inter") {
        diagnostics.push(
          makeDiagnostic(
            line,
            tokenIdx,
            `'${token}' is a server parameter name, not a server name`,
            "reserved-name",
            vscode.DiagnosticSeverity.Warning,
          ),
        );
      }
      continue;
    }

    if (spec.role === "address") {
      if (rule.kind === "server" && isServerMainAddressPlaceholder(token)) {
        continue;
      }
      const policy = policyForSlot(rule, spec, token);
      const addressParts =
        rule.kind === "bind"
          ? token
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part.length > 0)
          : [token];
      for (const part of addressParts) {
        pushAddressResult(line, tokenIdx, validateHaproxyAddress(part, policy), diagnostics);
      }
    }
  }

  return diagnostics;
}

function optionValuePolicy(
  rule: StatementRule,
  option: string,
  optionsWithValue: Set<string> | null,
): PortAddressPolicy | null {
  const lower = option.toLowerCase();
  if (rule.kind === "server") {
    const named = SERVER_ADDRESS_OPTION_POLICIES[lower];
    if (named) {
      return ADDRESS_POLICIES[named];
    }
    if (optionsWithValue?.has(lower)) {
      return null;
    }
  }
  if (rule.kind === "bind" && optionsWithValue?.has(lower)) {
    return null;
  }
  return null;
}

function remainingRequiredSlots(slots: Array<{ optional?: boolean }>, start: number): number {
  let required = 0;
  for (let i = start; i < slots.length; i += 1) {
    if (!slots[i]?.optional) {
      required += 1;
    }
  }
  return required;
}

function matchesLaterEnumSlot(
  slots: Array<{ enum?: string[]; optional?: boolean; value_kind?: string }>,
  schemaKw: ReturnType<typeof resolveSchemaKeyword>,
  slotIdx: number,
  lower: string,
): boolean {
  for (let idx = slotIdx + 1; idx < slots.length; idx += 1) {
    const allowedValues = enumNamesForSlot(slots[idx], schemaKw, idx).map((v) => v.toLowerCase());
    if (allowedValues.includes(lower) || allowedValues.includes(lower.split("(", 1)[0])) {
      return true;
    }
  }
  return false;
}

function signatureRequiresTrailingArgument(signatures: string[], token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\s+(?:<|\\{)`, "i");
  return signatures.some((signature) => re.test(signature));
}

function consumeOptionArguments(
  line: ParsedLine,
  optionIndex: number,
  condStart: number,
  rule: StatementRule,
  schema: HaproxySchema,
  allowed: Set<string>,
  valueOptions: Set<string> | null,
  diagnostics: vscode.Diagnostic[],
): number {
  const option = line.tokens[optionIndex].text.toLowerCase().replace(/\*$/, "");
  const schemaKw = resolveNestedOptionKeyword(schema, line, rule, option);
  const model = schemaKw?.argument_model;

  if (!model || model.max_args === undefined) {
    const addrPolicy = optionValuePolicy(rule, option, valueOptions);
    if (addrPolicy && optionIndex + 1 < condStart) {
      pushAddressResult(
        line,
        optionIndex + 1,
        validateHaproxyAddress(line.tokens[optionIndex + 1].text, addrPolicy),
        diagnostics,
      );
      return optionIndex + 2;
    }

    const takesValue = valueOptions?.has(option) ?? false;
    if (takesValue && optionIndex + 1 < condStart) {
      const next = line.tokens[optionIndex + 1].text.toLowerCase().replace(/\*$/, "");
      if (!allowed.has(next)) {
        return optionIndex + 2;
      }
    }
    return optionIndex + 1;
  }

  const slots = model.slots ?? [];
  const maxArgs = model.max_args === null ? Number.POSITIVE_INFINITY : model.max_args;
  let pos = optionIndex + 1;
  let slotIdx = 0;
  let consumed = 0;
  let pendingValueKeyword: { text: string; tokenIndex: number } | null = null;

  while (pos < condStart && slotIdx < slots.length && consumed < maxArgs) {
    const token = line.tokens[pos].text;
    const lower = token.toLowerCase();
    const base = lower.split("(", 1)[0];
    const tokenStartsOption = allowed.has(lower.replace(/\*$/, ""));
    const slot = slots[slotIdx];
    const allowedValues = enumNamesForSlot(slot, schemaKw, slotIdx).map((v) => v.toLowerCase());

    if (tokenStartsOption && remainingRequiredSlots(slots, slotIdx) === 0) {
      break;
    }

    if (allowedValues.length > 0) {
      if (allowedValues.includes(lower) || allowedValues.includes(base)) {
        pendingValueKeyword = signatureRequiresTrailingArgument(schemaKw?.signatures ?? [], token)
          ? { text: token, tokenIndex: pos }
          : null;
        pos += 1;
        consumed += 1;
        slotIdx += 1;
        continue;
      }
      if (slot.optional) {
        slotIdx += 1;
        continue;
      }
      if (tokenStartsOption) {
        diagnostics.push(
          makeDiagnostic(
            line,
            optionIndex,
            `'${line.tokens[optionIndex].text}' is missing required argument`,
            "missing-argument",
          ),
        );
        return pos;
      }
      pos += 1;
      consumed += 1;
      slotIdx += 1;
      continue;
    }

    if (slot.optional && matchesLaterEnumSlot(slots, schemaKw, slotIdx, lower)) {
      slotIdx += 1;
      continue;
    }

    pendingValueKeyword = null;

    if (slot.value_kind === "address" && slotIdx === 0) {
      const addrPolicy = optionValuePolicy(rule, option, valueOptions);
      if (addrPolicy) {
        pushAddressResult(line, pos, validateHaproxyAddress(token, addrPolicy), diagnostics);
      }
    }

    pos += 1;
    consumed += 1;
    slotIdx += 1;
  }

  if (
    pendingValueKeyword &&
    (pos >= condStart || allowed.has(line.tokens[pos].text.toLowerCase().replace(/\*$/, "")))
  ) {
    diagnostics.push(
      makeDiagnostic(
        line,
        pendingValueKeyword.tokenIndex,
        `'${pendingValueKeyword.text}' is missing required argument`,
        "missing-argument",
      ),
    );
  }

  if (consumed < model.min_args) {
    diagnostics.push(
      makeDiagnostic(
        line,
        optionIndex,
        `'${line.tokens[optionIndex].text}' is missing required argument`,
        "missing-argument",
      ),
    );
  }

  return pos;
}

function resolveNestedOptionKeyword(
  schema: HaproxySchema,
  line: ParsedLine,
  rule: StatementRule,
  option: string,
): ResolvedSchemaKeyword | undefined {
  const keyword = schema.keywords[option];
  if (!keyword) {
    return undefined;
  }
  const resolved = resolveSchemaKeyword(keyword, line.section);
  if (
    resolved &&
    line.section &&
    resolved.sections.includes(line.section) &&
    resolved.chapter?.startsWith("4.")
  ) {
    return resolved;
  }
  const chapter = rule.kind === "bind" ? "5.1" : rule.kind === "server" ? "5.2" : "";
  if (chapter) {
    const variant = keyword.variants?.find((item) => item.chapter === chapter);
    if (variant) {
      return {
        name: keyword.name,
        sections: variant.sections.length > 0 ? variant.sections : keyword.sections,
        signatures: variant.signatures.length > 0 ? variant.signatures : keyword.signatures,
        sources: keyword.sources,
        contexts: variant.contexts?.length ? variant.contexts : keyword.contexts,
        arguments: variant.arguments?.length ? variant.arguments : keyword.arguments,
        argument_model: variant.argument_model ?? keyword.argument_model,
        chapter: variant.chapter,
      };
    }
  }
  return resolved;
}

function scanNestedOptions(
  line: ParsedLine,
  rule: StatementRule,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const nestedStart = resolveLineOptionStartIndex(line, rule);
  const groupName = rule.group;
  if (!groupName) {
    return diagnostics;
  }

  const allowed = new Set((schema.keyword_groups[groupName] ?? []).map((v) => v.toLowerCase()));
  const valueOptions =
    rule.kind === "server" || rule.kind === "bind" ? optionsWithValueSet(schema, groupName) : null;
  if (valueOptions) {
    for (const opt of valueOptions) {
      allowed.add(opt);
    }
  }

  const condStart = conditionalStartIndex(line, 0);
  let i = nestedStart >= 0 ? nestedStart : line.tokens.length;

  while (i < condStart) {
    const raw = line.tokens[i].text;
    const opt = raw.toLowerCase().replace(/\*$/, "");

    if (allowed.has(opt)) {
      i = consumeOptionArguments(
        line,
        i,
        condStart,
        rule,
        schema,
        allowed,
        valueOptions,
        diagnostics,
      );
      continue;
    }

    if (/^[0-9]/.test(opt) || /^[0-9].*s$/i.test(opt)) {
      i += 1;
      continue;
    }

    diagnostics.push(
      makeDiagnostic(
        line,
        i,
        `Unknown ${rule.keyword} parameter '${raw}'`,
        "unknown-parameter",
        vscode.DiagnosticSeverity.Warning,
      ),
    );
    i += 1;
  }

  return diagnostics;
}

const LOG_ADDRESS_SKIP = new Set(["global", "stdout", "stderr"]);

function logLineDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  if (line.tokens[0]?.text.toLowerCase() !== "log" || line.tokens.length < 2) {
    return [];
  }
  const target = line.tokens[1].text;
  const lower = target.toLowerCase();
  if (
    LOG_ADDRESS_SKIP.has(lower) ||
    lower.startsWith("@") ||
    lower.startsWith("ring@") ||
    target.startsWith("/")
  ) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  pushAddressResult(line, 1, validateHaproxyAddress(target, ADDRESS_POLICIES.log), diagnostics);
  return diagnostics;
}

function sourceLineDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  if (line.tokens[0]?.text.toLowerCase() !== "source" || line.tokens.length < 2) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  pushAddressResult(
    line,
    1,
    validateHaproxyAddress(line.tokens[1].text, ADDRESS_POLICIES.source),
    diagnostics,
  );
  return diagnostics;
}

function tcpCheckLineDiagnostics(line: ParsedLine): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (let i = 1; i < line.tokens.length - 1; i += 1) {
    if (line.tokens[i].text.toLowerCase() === "addr") {
      pushAddressResult(
        line,
        i + 1,
        validateHaproxyAddress(line.tokens[i + 1].text, ADDRESS_POLICIES.tcpCheckAddr),
        diagnostics,
      );
    }
  }
  return diagnostics;
}

export function statementDiagnostics(line: ParsedLine, schema: HaproxySchema): vscode.Diagnostic[] {
  const t0 = line.tokens[0]?.text.toLowerCase() ?? "";

  if (t0 === "log") {
    return logLineDiagnostics(line);
  }
  if (t0 === "source") {
    return sourceLineDiagnostics(line);
  }
  if (t0 === "tcp-check" || t0 === "http-check") {
    return tcpCheckLineDiagnostics(line);
  }

  const rule = findStatementRule(schema, line);
  if (!rule) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  if (rule.fixed_slots?.length) {
    diagnostics.push(...validateFixedSlots(line, rule));
  }
  diagnostics.push(...scanNestedOptions(line, rule, schema));
  return diagnostics;
}
