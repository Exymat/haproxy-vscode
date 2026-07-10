import { describe, expect, it } from "vitest";

import {
  actionCompletionKindSet,
  actionGroupForCompletionKind,
  lineOptionGroupForKind,
  sampleExpressionGroupForKind,
  statementRuleGroupForKind,
  statementRuleKinds,
} from "../../src/schema/semantic";
import { loadAllSchemas } from "../helpers/schema";

describe("completion kind dispatch", () => {
  const schemas = loadAllSchemas();

  it("keeps statement rule kinds identical across bundled schema versions", () => {
    const reference = statementRuleKinds(schemas["3.2"]);
    for (const [version, schema] of Object.entries(schemas)) {
      expect(statementRuleKinds(schema)).toEqual(reference);
      expect(version).toBeTruthy();
    }
  });

  it("maps every statement rule kind to a completion handler path", () => {
    const schema = schemas["3.4"];
    for (const kind of statementRuleKinds(schema)) {
      const hasHandler =
        lineOptionGroupForKind(schema, kind) !== null ||
        actionGroupForCompletionKind(schema, kind) !== null ||
        statementRuleGroupForKind(schema, kind) !== null ||
        sampleExpressionGroupForKind(schema, kind) !== null ||
        kind === "directive";
      expect(hasHandler).toBe(true);
      expect(kind).toBeTruthy();
    }
    expect(actionCompletionKindSet(schema).size).toBeGreaterThan(0);
  });
});
