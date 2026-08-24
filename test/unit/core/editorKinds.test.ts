import { describe, expect, it } from "vitest";

import {
  RUNTIME_MODES,
  SCHEMA_COMPLETION_KINDS,
  SCHEMA_SYMBOL_KINDS,
} from "../../../src/core/editorKinds";
import { symbolKindList, symbolKindMap, symbolStringList } from "../../../src/schema/symbols";
import { sectionDefinitionKinds } from "../../../src/symbolIndex/types";
import { loadSchema } from "../../helpers/schema";

describe("editor kind unions", () => {
  it("cover all kinds emitted by bundled schemas", () => {
    const completionKinds = new Set<string>(SCHEMA_COMPLETION_KINDS);
    const symbolKinds = new Set<string>(SCHEMA_SYMBOL_KINDS);
    const runtimeModes = new Set<string>(RUNTIME_MODES);
    const missing: string[] = [];

    for (const version of ["2.6", "2.8", "3.0", "3.2", "3.4"] as const) {
      const schema = loadSchema(version);
      for (const rule of schema.statement_rules ?? []) {
        if (!completionKinds.has(rule.kind)) {
          missing.push(`${version} completion kind ${rule.kind}`);
        }
        if (rule.definition_kind && !symbolKinds.has(rule.definition_kind)) {
          missing.push(`${version} definition kind ${rule.definition_kind}`);
        }
        if (rule.reference_kind && !symbolKinds.has(rule.reference_kind)) {
          missing.push(`${version} reference kind ${rule.reference_kind}`);
        }
      }
      for (const kind of Object.values(sectionDefinitionKinds(schema))) {
        if (!symbolKinds.has(kind)) {
          missing.push(`${version} section kind ${kind}`);
        }
      }
      for (const mode of symbolStringList(schema, "runtime_modes")) {
        if (!runtimeModes.has(mode)) {
          missing.push(`${version} runtime mode ${mode}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("rejects unknown symbol kinds at schema metadata boundaries", () => {
    const schema = structuredClone(loadSchema("3.4"));
    schema.symbols.invalid_kind_list = ["not-a-symbol-kind"];
    schema.symbols.invalid_kind_map = { section: "not-a-symbol-kind" };
    expect(() => symbolKindList(schema, "invalid_kind_list")).toThrow("unknown symbol kind");
    expect(() => symbolKindMap(schema, "invalid_kind_map")).toThrow("unknown symbol kind");
  });
});
