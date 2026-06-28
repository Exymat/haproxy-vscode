import { describe, expect, it } from "vitest";

import { isKeywordValuePair, skipOptionalSlotGroup } from "../../src/argumentSlotValidation";
import { ArgumentModel } from "../../src/schema";

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
  });

  it("skipOptionalSlotGroup leaves index unchanged for normal slots", () => {
    const model: ArgumentModel = {
      min_args: 1,
      max_args: 1,
      slots: [{ optional: false, enum: ["http", "tcp"], value_kind: "enum", variadic: false }],
    };
    expect(skipOptionalSlotGroup(model, 0)).toBe(1);
  });
});
