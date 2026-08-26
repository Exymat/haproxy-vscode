/** Computes spans and argument bounds for HAProxy line options. */
import {
  enumValuesForSlotLower,
  isKeywordValuePair,
  matchesLaterEnumSlot,
  remainingRequiredSlots,
  signatureRequiresTrailingArgument,
  skipOptionalSlotGroup,
} from "../diagnostics/argumentSlotValidation";
import { addressPolicyForSchema, validateHaproxyAddress } from "../diagnostics/addressFormat";
import { resolveLineOptionSchemaKeyword } from "./lineOptionKeyword";
import { ParsedLine } from "../parser";
import { ArgumentModel, HaproxySchema, LineOptionSemantic, StatementRule } from "../schema/types";
import { optionsWithValueSet } from "../schema/keywords";

export interface LineOptionSpanContext {
  kind: string;
  line: ParsedLine;
  tokenIndex: number;
}

export interface LineOptionSpan {
  optionIndex: number;
  end: number;
  keyword: string;
}

function isValidBindAddressListToken(schema: HaproxySchema, token: string): boolean {
  const parts = token
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return false;
  }
  const bindPolicy = addressPolicyForSchema(schema, "bind");
  return parts.every((part) => {
    const policy = part.startsWith("/") ? { ...bindPolicy, portMandatory: false } : bindPolicy;
    return validateHaproxyAddress(part, policy).valid;
  });
}

export function resolveLineOptionStartIndex(
  schema: HaproxySchema,
  line: ParsedLine,
  rule: StatementRule | undefined,
): number {
  const baseStart = rule?.nested_start_index ?? -1;
  if (!rule || baseStart < 0) {
    return -1;
  }
  if (rule.kind !== "bind") {
    return baseStart;
  }

  let index = 1;
  while (index < line.tokens.length) {
    if (!isValidBindAddressListToken(schema, line.tokens[index].text)) {
      break;
    }
    index += 1;
  }
  return index > 1 ? index : baseStart;
}

export function lineOptionConditionalLimit(line: ParsedLine): number {
  for (let i = line.tokens.length - 1; i > 0; i -= 1) {
    const lower = line.tokens[i].text.toLowerCase();
    if (lower === "if" || lower === "unless") {
      return i;
    }
  }
  return line.tokens.length;
}

export function buildLineOptionAllowedSet(
  schema: HaproxySchema,
  lineOptionGroup: string,
): { allowed: Set<string>; valueOptions: Set<string> } {
  const allowed = new Set(
    (schema.keyword_groups[lineOptionGroup] ?? []).map((v) => v.toLowerCase()),
  );
  const valueOptions = optionsWithValueSet(schema, lineOptionGroup);
  for (const opt of valueOptions) {
    allowed.add(opt);
  }
  return { allowed, valueOptions };
}

function lineOptionSemantic(
  schema: HaproxySchema,
  option: string,
  kind: string | null | undefined,
): LineOptionSemantic | undefined {
  if (!kind) {
    return undefined;
  }
  return schema.keywords[option]?.line_option_semantics?.find((item) => item.parent_kind === kind);
}

function consumeUnmodeledLineOption(
  line: ParsedLine,
  optionIndex: number,
  limit: number,
  allowed: Set<string>,
  takesValue: boolean,
): number {
  if (takesValue && optionIndex + 1 < limit) {
    const next = line.tokens[optionIndex + 1].text.toLowerCase().replace(/\*$/, "");
    if (!allowed.has(next)) {
      return optionIndex + 2;
    }
  }
  return optionIndex + 1;
}

export function computeLineOptionArgumentEnd(
  schema: HaproxySchema,
  line: ParsedLine,
  optionIndex: number,
  limit: number,
  lineOptionGroup: string,
  kind: string | null | undefined,
  section: string | null,
): number {
  const { allowed, valueOptions } = buildLineOptionAllowedSet(schema, lineOptionGroup);
  const option = line.tokens[optionIndex].text.toLowerCase().replace(/\*$/, "");
  const semantic = lineOptionSemantic(schema, option, kind);
  const schemaKw = resolveLineOptionSchemaKeyword(schema, option, kind, section);
  const model = schemaKw?.argument_model;

  if (!model || model.max_args === undefined) {
    return consumeUnmodeledLineOption(
      line,
      optionIndex,
      limit,
      allowed,
      semantic?.takes_value ?? valueOptions.has(option),
    );
  }

  return consumeLineOptionSlots(line, optionIndex, limit, model, schemaKw, allowed);
}

interface LineOptionSlotState {
  pos: number;
  slotIdx: number;
  consumed: number;
  pendingValueKeyword: { tokenIndex: number } | null;
}

type LineOptionSlotStep = "advance" | "retry" | "stop";

function consumeLineOptionEnumSlot(args: {
  model: ArgumentModel;
  schemaKw: ReturnType<typeof resolveLineOptionSchemaKeyword>;
  slots: ArgumentModel["slots"];
  token: string;
  lower: string;
  base: string;
  tokenStartsOption: boolean;
  slot: ArgumentModel["slots"][number];
  allowedValues: string[];
  state: LineOptionSlotState;
}): LineOptionSlotStep | null {
  const {
    model,
    schemaKw,
    slots,
    token,
    lower,
    base,
    tokenStartsOption,
    slot,
    allowedValues,
    state,
  } = args;
  if (allowedValues.length === 0) {
    return null;
  }
  if (allowedValues.includes(lower) || allowedValues.includes(base)) {
    state.pendingValueKeyword = signatureRequiresTrailingArgument(schemaKw?.signatures ?? [], token)
      ? { tokenIndex: state.pos }
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
    state.pos += 1;
    state.consumed += 1;
    state.slotIdx += 1;
    return "advance";
  }
  if (tokenStartsOption) {
    return "stop";
  }
  state.pos += 1;
  state.consumed += 1;
  state.slotIdx += 1;
  return "advance";
}

function consumeLineOptionSlots(
  line: ParsedLine,
  optionIndex: number,
  limit: number,
  model: ArgumentModel,
  schemaKw: ReturnType<typeof resolveLineOptionSchemaKeyword>,
  allowed: Set<string>,
): number {
  const slots = model.slots ?? [];
  const maxArgs = model.max_args === null ? Number.POSITIVE_INFINITY : (model.max_args ?? 0);
  const state: LineOptionSlotState = {
    pos: optionIndex + 1,
    slotIdx: 0,
    consumed: 0,
    pendingValueKeyword: null,
  };

  while (state.pos < limit && state.slotIdx < slots.length && state.consumed < maxArgs) {
    const token = line.tokens[state.pos].text;
    const lower = token.toLowerCase();
    const base = lower.split("(", 1)[0];
    const tokenStartsOption = allowed.has(lower.replace(/\*$/, ""));
    const slot = slots[state.slotIdx];
    const allowedValues = enumValuesForSlotLower(slot, schemaKw, state.slotIdx);

    if (
      tokenStartsOption &&
      remainingRequiredSlots(slots, state.slotIdx) === 0 &&
      !matchesLaterEnumSlot(slots, schemaKw, state.slotIdx, lower)
    ) {
      break;
    }

    const enumStep = consumeLineOptionEnumSlot({
      model,
      schemaKw,
      slots,
      token,
      lower,
      base,
      tokenStartsOption,
      slot,
      allowedValues,
      state,
    });
    if (enumStep === "stop") {
      break;
    }
    if (enumStep === "retry" || enumStep === "advance") {
      continue;
    }

    if (slot.optional && matchesLaterEnumSlot(slots, schemaKw, state.slotIdx, lower)) {
      state.slotIdx += 1;
      continue;
    }

    state.pendingValueKeyword = null;
    state.pos += 1;
    state.consumed += 1;
    state.slotIdx += 1;
  }

  if (state.pendingValueKeyword && state.pos < limit) {
    const next = line.tokens[state.pos].text.toLowerCase().replace(/\*$/, "");
    if (!allowed.has(next)) {
      return state.pos + 1;
    }
  }

  return state.pos;
}

function tokenInActiveOptionSpan(
  ctx: LineOptionSpanContext,
  optionIndex: number,
  end: number,
  allowed: Set<string>,
): boolean {
  if (ctx.tokenIndex < optionIndex || ctx.tokenIndex > end) {
    return false;
  }
  if (ctx.tokenIndex < end) {
    return true;
  }
  const token = ctx.line.tokens[ctx.tokenIndex]?.text.toLowerCase().replace(/\*$/, "");
  return !token || !allowed.has(token);
}

export function resolveNestedLineOptionSpan(
  schema: HaproxySchema,
  ctx: LineOptionSpanContext,
  lineOptionGroup: string,
  lineOptionStart: number,
): LineOptionSpan | null {
  const { allowed } = buildLineOptionAllowedSet(schema, lineOptionGroup);
  const limit = lineOptionConditionalLimit(ctx.line);

  const spanEnd = (optionIndex: number): number =>
    computeLineOptionArgumentEnd(
      schema,
      ctx.line,
      optionIndex,
      limit,
      lineOptionGroup,
      ctx.kind,
      ctx.line.section,
    );

  for (let i = lineOptionStart; i < limit;) {
    const option = ctx.line.tokens[i].text.toLowerCase().replace(/\*$/, "");
    if (!allowed.has(option)) {
      i += 1;
      continue;
    }
    const end = Math.max(spanEnd(i), i + 1);
    if (tokenInActiveOptionSpan(ctx, i, end, allowed)) {
      const exactOption = ctx.line.tokens[ctx.tokenIndex]?.text.toLowerCase().replace(/\*$/, "");
      if (ctx.tokenIndex > i && exactOption && allowed.has(exactOption)) {
        const nestedEnd = Math.max(spanEnd(ctx.tokenIndex), ctx.tokenIndex + 1);
        if (ctx.tokenIndex < nestedEnd) {
          return { optionIndex: ctx.tokenIndex, end: nestedEnd, keyword: exactOption };
        }
      }
      return { optionIndex: i, end, keyword: option };
    }
    i = end;
  }

  return null;
}
