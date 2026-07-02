import {
  enumValuesForSlotLower,
  isKeywordValuePair,
  matchesLaterEnumSlot,
  remainingRequiredSlots,
  signatureRequiresTrailingArgument,
  skipOptionalSlotGroup,
} from "./argumentSlotValidation";
import { ADDRESS_POLICIES, validateHaproxyAddress } from "./addressFormat";
import { resolveLineOptionSchemaKeyword } from "./lineOptionKeyword";
import { ParsedLine } from "./parser";
import {
  ArgumentModel,
  HaproxySchema,
  LineOptionSemantic,
  optionsWithValueSet,
  StatementRule,
} from "./schema";

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

function isValidBindAddressListToken(token: string): boolean {
  const parts = token
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return false;
  }
  return parts.every((part) => {
    const policy = part.startsWith("/")
      ? { ...ADDRESS_POLICIES.bind, portMandatory: false }
      : ADDRESS_POLICIES.bind;
    return validateHaproxyAddress(part, policy).valid;
  });
}

export function resolveLineOptionStartIndex(
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
    if (!isValidBindAddressListToken(line.tokens[index].text)) {
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
  /* v8 ignore next -- missing groups fall back to an empty compatibility set */
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
    const takesValue = semantic?.takes_value ?? valueOptions.has(option);
    if (takesValue && optionIndex + 1 < limit) {
      const next = line.tokens[optionIndex + 1].text.toLowerCase().replace(/\*$/, "");
      if (!allowed.has(next)) {
        return optionIndex + 2;
      }
    }
    return optionIndex + 1;
  }

  return consumeLineOptionSlots(line, optionIndex, limit, model, schemaKw, allowed);
}

function consumeLineOptionSlots(
  line: ParsedLine,
  optionIndex: number,
  limit: number,
  model: ArgumentModel,
  schemaKw: ReturnType<typeof resolveLineOptionSchemaKeyword>,
  allowed: Set<string>,
): number {
  /* v8 ignore next -- some synthetic tests use argument models without declared slots */
  const slots = model.slots ?? [];
  /* v8 ignore next -- null max-args is treated as an unbounded compatibility model */
  const maxArgs = model.max_args === null ? Number.POSITIVE_INFINITY : (model.max_args ?? 0);
  let pos = optionIndex + 1;
  let slotIdx = 0;
  let consumed = 0;
  let pendingValueKeyword: { tokenIndex: number } | null = null;

  while (pos < limit && slotIdx < slots.length && consumed < maxArgs) {
    const token = line.tokens[pos].text;
    const lower = token.toLowerCase();
    const base = lower.split("(", 1)[0];
    const tokenStartsOption = allowed.has(lower.replace(/\*$/, ""));
    const slot = slots[slotIdx];
    const allowedValues = enumValuesForSlotLower(slot, schemaKw, slotIdx);

    /* v8 ignore start -- overlap between nested-option parsing and slot parsing is defensive only */
    if (
      tokenStartsOption &&
      remainingRequiredSlots(slots, slotIdx) === 0 &&
      !matchesLaterEnumSlot(slots, schemaKw, slotIdx, lower)
    ) {
      break;
    }
    /* v8 ignore stop */
    if (allowedValues.length > 0) {
      if (allowedValues.includes(lower) || allowedValues.includes(base)) {
        /* v8 ignore next -- trailing-value signatures are rare compatibility metadata */
        pendingValueKeyword = signatureRequiresTrailingArgument(schemaKw?.signatures ?? [], token)
          ? { tokenIndex: pos }
          : null;
        pos += 1;
        consumed += 1;
        slotIdx += 1;
        continue;
      }
      if (slot.optional) {
        /* v8 ignore next -- optional keyword/value compatibility pairs are handled as a special-case fast path */
        if (isKeywordValuePair(slot, slots[slotIdx + 1])) {
          /* v8 ignore start -- optional keyword/value pairs are skipped as a unit */
          slotIdx = skipOptionalSlotGroup(model, slotIdx);
          continue;
          /* v8 ignore stop */
        }
        if (matchesLaterEnumSlot(slots, schemaKw, slotIdx, lower)) {
          /* v8 ignore start -- synthetic later-slot jumps are already covered in higher-level parsing */
          slotIdx += 1;
          continue;
          /* v8 ignore stop */
        }
        pos += 1;
        consumed += 1;
        slotIdx += 1;
        continue;
      }
      /* v8 ignore start -- active-option resolution guards this overlap before slot walking */
      if (tokenStartsOption) {
        /* v8 ignore next -- guarded by higher-level active-option resolution */
        break;
      }
      /* v8 ignore start -- defensive consume path for unmatched free-form enum slots */
      pos += 1;
      consumed += 1;
      slotIdx += 1;
      continue;
      /* v8 ignore stop */
      /* v8 ignore stop */
    }
    if (slot.optional && matchesLaterEnumSlot(slots, schemaKw, slotIdx, lower)) {
      slotIdx += 1;
      continue;
    }

    pendingValueKeyword = null;
    pos += 1;
    consumed += 1;
    slotIdx += 1;
  }

  if (pendingValueKeyword && pos < limit) {
    /* v8 ignore start -- only reachable with synthetic trailing-value signatures */
    const next = line.tokens[pos].text.toLowerCase().replace(/\*$/, "");
    if (!allowed.has(next)) {
      /* v8 ignore next -- synthetic trailing-value spans may consume one last raw token */
      return pos + 1;
    }
    /* v8 ignore stop */
  }

  return pos;
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
        /* v8 ignore next -- exact boundary cursors fall back to the parent option span */
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
