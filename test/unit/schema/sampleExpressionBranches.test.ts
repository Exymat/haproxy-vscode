import { describe, expect, it } from "vitest";

import { canCast, resolveOutType } from "../../../src/parser/expressionTypes";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("sample expression type branch behavior", () => {
  it("allows unknown cast rows and resolves same-type outputs", () => {
    expect(canCast("missing-row", "str", bundle.schema)).toBe(true);
    expect(resolveOutType("str", { out_type: "same", in_type: "sint" }, bundle.schema)).toBe(
      "sint",
    );
  });

  it("rejects sparse cast tables and resolves fallback output types", () => {
    const sparseSchema = {
      ...bundle.schema,
      sample_types: ["from", "to"],
      sample_casts: [[]],
    };

    expect(canCast("bool", "meth", bundle.schema)).toBe(false);
    expect(resolveOutType("bool", { out_type: "same", in_type: "meth" }, bundle.schema)).toBe(
      "bool",
    );
    expect(canCast("from", "to", sparseSchema)).toBe(false);
    expect(resolveOutType("str", {}, bundle.schema)).toBe("str");
    expect(resolveOutType("str", { out_type: "bin" }, bundle.schema)).toBe("bin");
  });
});
