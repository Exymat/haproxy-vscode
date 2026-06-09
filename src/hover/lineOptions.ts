import { enumNamesForSlot } from "../argumentEnumUtils";
import { ADDRESS_POLICIES, validateHaproxyAddress } from "../addressFormat";
import { getKeywordFromSchema } from "../directiveUtils";
import { getDocumentContext } from "../documentContext";
import { HaproxySchema, optionsWithValueSet, StatementRule } from "../schema";

export function lineOptionChapter(kind: "bind" | "server"): string {
  return kind === "bind" ? "5.1" : "5.2";
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
  schemaKw: ReturnType<typeof getKeywordFromSchema>,
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

export function resolveLineOptionSchemaKeyword(
  schema: HaproxySchema,
  option: string,
  kind: string | null | undefined,
  section: string | null | undefined,
) {
  const keyword = schema.keywords[option];
  if (!keyword) {
    return undefined;
  }
  const resolved = getKeywordFromSchema(schema, option, section);
  if (
    resolved &&
    section &&
    resolved.sections.includes(section) &&
    resolved.chapter?.startsWith("4.")
  ) {
    return resolved;
  }
  const chapter = kind === "bind" || kind === "server" ? lineOptionChapter(kind) : "";
  const variant = chapter ? keyword.variants?.find((item) => item.chapter === chapter) : undefined;
  if (!variant) {
    return resolved;
  }
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
  line: NonNullable<ReturnType<typeof getDocumentContext>>["line"],
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

export function resolveNestedLineOptionSpan(
  schema: HaproxySchema,
  ctx: NonNullable<ReturnType<typeof getDocumentContext>>,
  lineOptionGroup: string,
  lineOptionStart: number,
): { optionIndex: number; end: number; keyword: string } | null {
  const allowed = new Set(
    (schema.keyword_groups[lineOptionGroup] ?? []).map((v) => v.toLowerCase()),
  );
  const valueOptions = optionsWithValueSet(schema, lineOptionGroup);
  for (const opt of valueOptions) {
    allowed.add(opt);
  }

  let limit = ctx.line.tokens.length;
  for (let i = ctx.line.tokens.length - 1; i > 0; i -= 1) {
    const lower = ctx.line.tokens[i].text.toLowerCase();
    if (lower === "if" || lower === "unless") {
      limit = i;
      break;
    }
  }

  const spanEnd = (optionIndex: number): number => {
    const option = ctx.line.tokens[optionIndex].text.toLowerCase().replace(/\*$/, "");
    const schemaKw = resolveLineOptionSchemaKeyword(schema, option, ctx.kind, ctx.line.section);
    const model = schemaKw?.argument_model;

    if (!model || model.max_args === undefined) {
      if (valueOptions.has(option) && optionIndex + 1 < limit) {
        const next = ctx.line.tokens[optionIndex + 1].text.toLowerCase().replace(/\*$/, "");
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

    while (pos < limit && slotIdx < slots.length && consumed < maxArgs) {
      const token = ctx.line.tokens[pos].text;
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
          break;
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
      pos += 1;
      consumed += 1;
      slotIdx += 1;
    }

    return pos;
  };

  for (let i = lineOptionStart; i < limit; ) {
    const option = ctx.line.tokens[i].text.toLowerCase().replace(/\*$/, "");
    if (!allowed.has(option)) {
      i += 1;
      continue;
    }
    const end = Math.max(spanEnd(i), i + 1);
    if (ctx.tokenIndex >= i && ctx.tokenIndex < end) {
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
