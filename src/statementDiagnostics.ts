import * as vscode from "vscode";

import {
  enumValuesForSlotLower,
  matchesLaterEnumSlot,
  remainingRequiredSlots,
} from "./argumentSlotValidation";
import { resolveNestedOptionKeyword } from "./lineOptionKeyword";
import {
  ADDRESS_POLICIES,
  AddressPolicyName,
  AddressValidationResult,
  isServerMainAddressPlaceholder,
  PortAddressPolicy,
  validateHaproxyAddress,
} from "./addressFormat";
import { conditionalStartIndex } from "./directiveUtils";
import { makeLineDiagnostic } from "./diagnosticUtils";
import { resolveLineOptionStartIndex } from "./lineOptionSpan";
import { ParsedLine } from "./parser";
import {
  FixedSlotSpec,
  HaproxySchema,
  keywordGroupSet,
  lineOptionSet,
  optionsWithValueSet,
  StatementRule,
} from "./schema";
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
  return makeLineDiagnostic(line, tokenIndex, message, code, severity);
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
  const schemaKw = resolveNestedOptionKeyword(schema, line.section, rule.kind, option);
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
    const allowedValues = enumValuesForSlotLower(slot, schemaKw, slotIdx);

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

  const valueOptions =
    rule.kind === "server" || rule.kind === "bind" ? optionsWithValueSet(schema, groupName) : null;
  const allowed = valueOptions
    ? lineOptionSet(schema, groupName)
    : keywordGroupSet(schema, groupName);

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

export function statementDiagnostics(
  line: ParsedLine,
  schema: HaproxySchema,
  rule: StatementRule | undefined = findStatementRule(schema, line),
): vscode.Diagnostic[] {
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
