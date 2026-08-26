/** Validates statement-rule argument shapes, including addresses and fixed slots. */

import * as vscode from "vscode";

import {
  enumValuesForSlotLower,
  isKeywordValuePair,
  matchesLaterEnumSlot,
  remainingRequiredSlots,
  signatureRequiresTrailingArgument,
  skipOptionalSlotGroup,
} from "./argumentSlotValidation";
import { resolveNestedOptionKeyword } from "../language/lineOptionKeyword";
import { ResolvedSchemaKeyword } from "../language/keywordVariant";
import {
  AddressValidationResult,
  isServerMainAddressPlaceholder,
  PortAddressPolicy,
  addressPolicyForSchema,
  validateHaproxyAddress,
} from "./addressFormat";
import { conditionalStartIndex } from "../language/directiveUtils";
import { makeLineDiagnostic } from "./diagnosticUtils";
import { resolveLineOptionStartIndex } from "../language/lineOptionSpan";
import { ParsedLine } from "../parser";
import {
  ArgumentModel,
  ArgumentSlot,
  FixedSlotSpec,
  HaproxySchema,
  StatementRule,
} from "../schema/types";
import {
  validationStringList,
  validationStringMap,
  addressDirectivePolicyKey,
} from "../schema/validation";
import { keywordGroupSet, lineOptionSet, optionsWithValueSet } from "../schema/keywords";
import { findStatementRule } from "../schema/statementLayout";
import { lowerToken, normalizedOptionToken } from "../parser/tokenUtils";

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

function makeStmtDiagnostic(
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
  diagnostics.push(makeStmtDiagnostic(line, tokenIndex, result.message, code));
}

function policyForSlot(
  schema: HaproxySchema,
  rule: StatementRule,
  spec: FixedSlotSpec,
  token: string,
): PortAddressPolicy {
  if (spec.address_policy) {
    const named = spec.address_policy;
    const policy = addressPolicyForSchema(schema, named);
    if (named === "bind" && token.startsWith("/")) {
      return { ...policy, portMandatory: false };
    }
    return policy;
  }
  if (rule.kind === "bind") {
    const bindPolicy = addressPolicyForSchema(schema, "bind");
    return token.startsWith("/") ? { ...bindPolicy, portMandatory: false } : bindPolicy;
  }
  return addressPolicyForSchema(schema, "server");
}

function validateFixedSlots(
  line: ParsedLine,
  schema: HaproxySchema,
  rule: StatementRule,
  slots: FixedSlotSpec[],
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const nestedStart = resolveLineOptionStartIndex(schema, line, rule);
  const condStart = conditionalStartIndex(line, 0);
  const limit = Math.min(condStart, nestedStart >= 0 ? nestedStart : 1 + slots.length);

  for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
    const tokenIdx = 1 + slotIdx;
    if (tokenIdx >= limit) {
      diagnostics.push(
        makeStmtDiagnostic(
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
          makeStmtDiagnostic(
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
      const policy = policyForSlot(schema, rule, spec, token);
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
  schema: HaproxySchema,
  rule: StatementRule,
  option: string,
  optionsWithValue: Set<string> | null,
): PortAddressPolicy | null {
  const lower = lowerToken(option);
  if (rule.kind === "server") {
    const named = validationStringMap(schema, "server_address_option_policies")[lower];
    if (named) {
      return addressPolicyForSchema(schema, named);
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

function consumeUnmodeledOptionValue(
  line: ParsedLine,
  optionIndex: number,
  condStart: number,
  rule: StatementRule,
  schema: HaproxySchema,
  allowed: Set<string>,
  valueOptions: Set<string> | null,
  diagnostics: vscode.Diagnostic[],
  option: string,
): number {
  const addrPolicy = optionValuePolicy(schema, rule, option, valueOptions);
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
    const next = normalizedOptionToken(line.tokens[optionIndex + 1].text);
    if (!allowed.has(next)) {
      return optionIndex + 2;
    }
  }
  return optionIndex + 1;
}

interface OptionConsumeState {
  pos: number;
  slotIdx: number;
  consumed: number;
  pendingValueKeyword: { text: string; tokenIndex: number } | null;
}

type OptionSlotStep = "advance" | "retry" | "stop" | "return";

function consumeEnumOptionSlot(args: {
  line: ParsedLine;
  optionIndex: number;
  schema: HaproxySchema;
  schemaKw: ResolvedSchemaKeyword | undefined;
  slots: ArgumentSlot[];
  model: ArgumentModel;
  token: string;
  lower: string;
  base: string;
  tokenStartsOption: boolean;
  slot: ArgumentSlot;
  allowedValues: string[];
  state: OptionConsumeState;
  diagnostics: vscode.Diagnostic[];
}): OptionSlotStep | null {
  const {
    line,
    optionIndex,
    schema,
    schemaKw,
    slots,
    model,
    token,
    lower,
    base,
    tokenStartsOption,
    slot,
    allowedValues,
    state,
    diagnostics,
  } = args;
  if (allowedValues.length === 0) {
    return null;
  }
  if (allowedValues.includes(lower) || allowedValues.includes(base)) {
    state.pendingValueKeyword = signatureRequiresTrailingArgument(schemaKw?.signatures ?? [], token)
      ? { text: token, tokenIndex: state.pos }
      : null;
    state.pos += 1;
    state.consumed += 1;
    state.slotIdx += 1;
    return "advance";
  }
  if (slot.optional) {
    if (isKeywordValuePair(slot, slots[state.slotIdx + 1])) {
      state.slotIdx = skipOptionalSlotGroup(model, state.slotIdx);
      return "retry";
    }
    if (matchesLaterEnumSlot(slots, schemaKw, state.slotIdx, lower)) {
      state.slotIdx += 1;
      return "retry";
    }
    if (state.pendingValueKeyword) {
      const policyName = validationStringMap(schema, "server_address_option_policies")[
        lowerToken(state.pendingValueKeyword.text)
      ];
      if (policyName) {
        pushAddressResult(
          line,
          state.pos,
          validateHaproxyAddress(token, addressPolicyForSchema(schema, policyName)),
          diagnostics,
        );
      }
      state.pendingValueKeyword = null;
    }
    state.pos += 1;
    state.consumed += 1;
    state.slotIdx += 1;
    return "advance";
  }
  if (tokenStartsOption) {
    diagnostics.push(
      makeStmtDiagnostic(
        line,
        optionIndex,
        `'${line.tokens[optionIndex].text}' is missing required argument`,
        "missing-argument",
      ),
    );
    return "return";
  }
  state.pos += 1;
  state.consumed += 1;
  state.slotIdx += 1;
  return "advance";
}

function stepOptionSlot(args: {
  line: ParsedLine;
  optionIndex: number;
  rule: StatementRule;
  schema: HaproxySchema;
  schemaKw: ResolvedSchemaKeyword | undefined;
  option: string;
  allowed: Set<string>;
  valueOptions: Set<string> | null;
  model: ArgumentModel;
  state: OptionConsumeState;
  diagnostics: vscode.Diagnostic[];
}): OptionSlotStep {
  const {
    line,
    optionIndex,
    rule,
    schema,
    schemaKw,
    option,
    allowed,
    valueOptions,
    model,
    state,
    diagnostics,
  } = args;
  const slots = model.slots;
  const token = line.tokens[state.pos].text;
  const lower = lowerToken(token);
  const base = lower.split("(", 1)[0];
  const tokenStartsOption = allowed.has(lower.replace(/\*$/, ""));
  const slot = slots[state.slotIdx];
  const allowedValues = enumValuesForSlotLower(slot, schemaKw, state.slotIdx);

  if (
    tokenStartsOption &&
    remainingRequiredSlots(slots, state.slotIdx) === 0 &&
    !matchesLaterEnumSlot(slots, schemaKw, state.slotIdx, lower)
  ) {
    return "stop";
  }

  const enumStep = consumeEnumOptionSlot({
    line,
    optionIndex,
    schema,
    schemaKw,
    slots,
    model,
    token,
    lower,
    base,
    tokenStartsOption,
    slot,
    allowedValues,
    state,
    diagnostics,
  });
  if (enumStep) {
    return enumStep;
  }

  if (slot.optional && matchesLaterEnumSlot(slots, schemaKw, state.slotIdx, lower)) {
    state.slotIdx += 1;
    return "retry";
  }

  state.pendingValueKeyword = null;

  if (slot.value_kind === "address" && state.slotIdx === 0) {
    const addrPolicy = optionValuePolicy(schema, rule, option, valueOptions);
    if (addrPolicy) {
      pushAddressResult(line, state.pos, validateHaproxyAddress(token, addrPolicy), diagnostics);
    }
  }

  state.pos += 1;
  state.consumed += 1;
  state.slotIdx += 1;
  return "advance";
}

function finishPendingOptionValue(
  line: ParsedLine,
  condStart: number,
  allowed: Set<string>,
  state: OptionConsumeState,
  diagnostics: vscode.Diagnostic[],
): number | null {
  if (!state.pendingValueKeyword) {
    return null;
  }
  if (state.pos < condStart) {
    const next = normalizedOptionToken(line.tokens[state.pos].text);
    if (!allowed.has(next)) {
      return state.pos + 1;
    }
  }
  diagnostics.push(
    makeStmtDiagnostic(
      line,
      state.pendingValueKeyword.tokenIndex,
      `'${line.tokens[state.pendingValueKeyword.tokenIndex].text}' is missing required argument`,
      "missing-argument",
    ),
  );
  return null;
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
  const option = normalizedOptionToken(line.tokens[optionIndex].text);
  const schemaKw = resolveNestedOptionKeyword(schema, line.section, rule.kind, option);
  const model = schemaKw?.argument_model;

  if (!model || model.max_args === undefined) {
    return consumeUnmodeledOptionValue(
      line,
      optionIndex,
      condStart,
      rule,
      schema,
      allowed,
      valueOptions,
      diagnostics,
      option,
    );
  }

  const maxArgs = model.max_args === null ? Number.POSITIVE_INFINITY : model.max_args;
  const state: OptionConsumeState = {
    pos: optionIndex + 1,
    slotIdx: 0,
    consumed: 0,
    pendingValueKeyword: null,
  };

  while (state.pos < condStart && state.slotIdx < model.slots.length && state.consumed < maxArgs) {
    const step = stepOptionSlot({
      line,
      optionIndex,
      rule,
      schema,
      schemaKw,
      option,
      allowed,
      valueOptions,
      model,
      state,
      diagnostics,
    });
    if (step === "return") {
      return state.pos;
    }
    if (step === "stop") {
      break;
    }
  }

  const pendingEnd = finishPendingOptionValue(line, condStart, allowed, state, diagnostics);
  if (pendingEnd !== null) {
    return pendingEnd;
  }

  if (state.consumed < model.min_args) {
    diagnostics.push(
      makeStmtDiagnostic(
        line,
        optionIndex,
        `'${line.tokens[optionIndex].text}' is missing required argument`,
        "missing-argument",
      ),
    );
  }

  return state.pos;
}

function scanNestedOptions(
  line: ParsedLine,
  rule: StatementRule,
  schema: HaproxySchema,
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const nestedStart = resolveLineOptionStartIndex(schema, line, rule);
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
    const opt = normalizedOptionToken(raw);

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
      makeStmtDiagnostic(
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

function logLineDiagnostics(line: ParsedLine, schema: HaproxySchema): vscode.Diagnostic[] {
  if (line.tokens.length < 2) {
    return [];
  }
  const target = line.tokens[1].text;
  const lower = lowerToken(target);
  const logAddressSkip = new Set(validationStringList(schema, "log_address_skip"));
  if (
    logAddressSkip.has(lower) ||
    lower.startsWith("@") ||
    lower.startsWith("ring@") ||
    target.startsWith("/")
  ) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  pushAddressResult(
    line,
    1,
    validateHaproxyAddress(target, addressPolicyForSchema(schema, "log")),
    diagnostics,
  );
  return diagnostics;
}

function sourceLineDiagnostics(line: ParsedLine, schema: HaproxySchema): vscode.Diagnostic[] {
  if (line.tokens.length < 2) {
    return [];
  }
  const diagnostics: vscode.Diagnostic[] = [];
  pushAddressResult(
    line,
    1,
    validateHaproxyAddress(line.tokens[1].text, addressPolicyForSchema(schema, "source")),
    diagnostics,
  );
  return diagnostics;
}

function tcpCheckLineDiagnostics(line: ParsedLine, schema: HaproxySchema): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  for (let i = 1; i < line.tokens.length - 1; i += 1) {
    if (lowerToken(line.tokens[i].text) === "addr") {
      pushAddressResult(
        line,
        i + 1,
        validateHaproxyAddress(
          line.tokens[i + 1].text,
          addressPolicyForSchema(schema, "tcpCheckAddr"),
        ),
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
  const t0 = lowerToken(line.tokens[0]?.text ?? "");
  const policyKey = addressDirectivePolicyKey(schema, t0);
  if (policyKey) {
    if (t0 === "log") {
      return logLineDiagnostics(line, schema);
    }
    if (t0 === "source") {
      return sourceLineDiagnostics(line, schema);
    }
    if (t0 === "tcp-check" || t0 === "http-check") {
      return tcpCheckLineDiagnostics(line, schema);
    }
  }

  if (!rule) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const fixedSlots = rule.fixed_slots;
  if (fixedSlots?.length) {
    diagnostics.push(...validateFixedSlots(line, schema, rule, fixedSlots));
  }
  diagnostics.push(...scanNestedOptions(line, rule, schema));
  return diagnostics;
}
