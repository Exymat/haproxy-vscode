import { enumNamesForSlotLower } from "./argumentEnumUtils";
import { ArgumentModel, ArgumentSlot } from "./schema";
import { ResolvedSchemaKeyword } from "./keywordVariant";

export function remainingRequiredSlots(
  slots: Array<{ optional?: boolean }>,
  start: number,
): number {
  let required = 0;
  for (let i = start; i < slots.length; i += 1) {
    if (!slots[i]?.optional) {
      required += 1;
    }
  }
  return required;
}

export function enumValuesForSlotLower(
  slot: ArgumentSlot | undefined,
  schemaKw: ResolvedSchemaKeyword | undefined,
  position: number,
): string[] {
  return enumNamesForSlotLower(slot, schemaKw, position);
}

export function matchesLaterEnumSlot(
  slots: ArgumentSlot[],
  schemaKw: ResolvedSchemaKeyword | undefined,
  slotIdx: number,
  lower: string,
): boolean {
  const base = lower.split("(", 1)[0];
  for (let idx = slotIdx + 1; idx < slots.length; idx += 1) {
    const allowedValues = enumValuesForSlotLower(slots[idx], schemaKw, idx);
    if (allowedValues.includes(lower) || allowedValues.includes(base)) {
      return true;
    }
  }
  return false;
}

export function matchesLaterEnumSlotInModel(
  model: ArgumentModel,
  slotIdx: number,
  lower: string,
  schemaKw: ResolvedSchemaKeyword | undefined,
): boolean {
  return matchesLaterEnumSlot(model.slots, schemaKw, slotIdx, lower);
}

export function signatureRequiresTrailingArgument(signatures: string[], token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\s+(?:<|\\{)`, "i");
  return signatures.some((signature) => re.test(signature));
}

export function isKeywordValuePair(
  slot: ArgumentSlot | undefined,
  nextSlot: ArgumentSlot | undefined,
): boolean {
  return Boolean(
    slot?.optional &&
    (slot.enum?.length ?? 0) > 0 &&
    nextSlot?.optional &&
    !(nextSlot.enum?.length ?? 0) &&
    !nextSlot?.variadic,
  );
}

export function skipOptionalSlotGroup(model: ArgumentModel, slotIdx: number): number {
  const slot = model.slots[slotIdx];
  let next = slotIdx + 1;
  if (isKeywordValuePair(slot, model.slots[next])) {
    next += 1;
  }
  return next;
}

export function slotForPosition(model: ArgumentModel, position: number): ArgumentSlot | undefined {
  if (position < model.slots.length) {
    return model.slots[position];
  }
  const tail = model.slots.at(-1);
  return tail?.variadic ? tail : undefined;
}

export function hasArgumentModelValidation(
  model: ArgumentModel | undefined,
): model is ArgumentModel {
  if (!model) {
    return false;
  }
  if (model.max_args !== null && model.max_args !== undefined) {
    return true;
  }
  return model.slots.some((slot) => (slot.enum?.length ?? 0) > 0);
}
