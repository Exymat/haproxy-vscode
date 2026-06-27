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

export function isKeywordValuePair(
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

export function skipOptionalSlotGroup(model: ArgumentModel, slotIdx: number): number {
  const slot = model.slots[slotIdx];
  let next = slotIdx + 1;
  if (isKeywordValuePair(slot, model.slots[next])) {
    next += 1;
  }
  return next;
}
