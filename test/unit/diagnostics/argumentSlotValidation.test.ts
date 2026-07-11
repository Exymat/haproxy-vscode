import { describe, expect, it } from "vitest";

import {
  hasArgumentModelValidation,
  isKeywordValuePair,
  skipOptionalSlotGroup,
  slotForPosition,
} from "../../../src/diagnostics/argumentSlotValidation";
import { ArgumentModel } from "../../../src/schema/types";

describe("argumentSlotValidation", () => {
  it("detects optional enum keyword followed by optional generic value slot", () => {
    const slots = [
      { optional: true, enum: ["alpha"], value_kind: "enum" as const, variadic: false },
      { optional: true, enum: [], value_kind: "generic" as const, variadic: false },
    ];
    expect(isKeywordValuePair(slots[0], slots[1])).toBe(true);
    expect(skipOptionalSlotGroup({ min_args: 0, max_args: 2, slots }, 0)).toBe(2);
  });

  it("rejects keyword-value pairs when slots do not match the pattern", () => {
    expect(isKeywordValuePair(undefined, undefined)).toBe(false);
    expect(
      isKeywordValuePair(
        { optional: false, enum: ["alpha"], value_kind: "enum", variadic: false },
        { optional: true, enum: [], value_kind: "generic", variadic: false },
      ),
    ).toBe(false);
    expect(
      isKeywordValuePair(
        { optional: true, enum: [], value_kind: "enum", variadic: false },
        { optional: true, enum: [], value_kind: "generic", variadic: false },
      ),
    ).toBe(false);
    expect(
      isKeywordValuePair(
        { optional: true, enum: ["alpha"], value_kind: "enum", variadic: false },
        { optional: false, enum: [], value_kind: "generic", variadic: false },
      ),
    ).toBe(false);
    expect(
      isKeywordValuePair(
        { optional: true, enum: ["alpha"], value_kind: "enum", variadic: false },
        { optional: true, value_kind: "generic", variadic: false },
      ),
    ).toBe(true);
    expect(
      isKeywordValuePair(
        { optional: true, enum: ["check_post"], value_kind: "enum", variadic: false },
        { optional: true, enum: [], value_kind: "generic", variadic: true },
      ),
    ).toBe(false);
  });

  it("skipOptionalSlotGroup leaves index unchanged for normal slots", () => {
    const model: ArgumentModel = {
      min_args: 1,
      max_args: 1,
      slots: [{ optional: false, enum: ["http", "tcp"], value_kind: "enum", variadic: false }],
    };
    expect(skipOptionalSlotGroup(model, 0)).toBe(1);
  });

  it("slotForPosition resolves in-range and variadic tail slots", () => {
    const model: ArgumentModel = {
      min_args: 1,
      max_args: null,
      slots: [
        { optional: false, enum: [], value_kind: "name", variadic: false },
        { optional: true, enum: [], value_kind: "generic", variadic: true },
      ],
    };
    expect(slotForPosition(model, 0)?.value_kind).toBe("name");
    expect(slotForPosition(model, 1)?.variadic).toBe(true);
    expect(slotForPosition(model, 3)?.variadic).toBe(true);
  });

  it("slotForPosition returns undefined past fixed slots without a variadic tail", () => {
    const model: ArgumentModel = {
      min_args: 1,
      max_args: 2,
      slots: [
        { optional: false, enum: [], value_kind: "name", variadic: false },
        { optional: true, enum: ["check_post"], value_kind: "enum", variadic: false },
      ],
    };
    expect(slotForPosition(model, 2)).toBeUndefined();
  });

  it("hasArgumentModelValidation detects models worth validating", () => {
    expect(hasArgumentModelValidation(undefined)).toBe(false);
    expect(
      hasArgumentModelValidation({ min_args: 0, max_args: 1, slots: [{ optional: true }] }),
    ).toBe(true);
    expect(
      hasArgumentModelValidation({
        min_args: 0,
        max_args: null,
        slots: [{ optional: true, enum: ["foo"], value_kind: "enum", variadic: false }],
      }),
    ).toBe(true);
    expect(
      hasArgumentModelValidation({
        min_args: 0,
        max_args: null,
        slots: [{ optional: true, value_kind: "generic", variadic: false }],
      }),
    ).toBe(false);
  });
});
