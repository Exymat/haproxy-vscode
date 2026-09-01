import {
  findRuntimeVariableHits,
  findUnparenthesizedRuntimeVariable,
  isRuntimeVariableName,
  runtimeVariableArgumentExpectedAt,
  runtimeVariableNameExpectedAt,
  unparenthesizedRuntimeVariableExpectedAt,
} from "../../../src/core/runtimeVariables";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import type { ParsedLine } from "../../../src/parser";

function token(text: string, start = 0) {
  return { text, start, end: start + text.length };
}

describe("runtimeVariables", () => {
  it("validates HAProxy runtime variable names", () => {
    expect(isRuntimeVariableName("http_host")).toBe(true);
    expect(isRuntimeVariableName("txn.foo")).toBe(true);
    expect(isRuntimeVariableName("req.current_hour")).toBe(true);
    expect(isRuntimeVariableName("1bad")).toBe(false);
    expect(isRuntimeVariableName("txn.")).toBe(false);
    expect(isRuntimeVariableName("txn.foo-bar")).toBe(false);
  });

  it("finds set-var, set-var-fmt, unset-var, and var names in a token", () => {
    const hits = findRuntimeVariableHits(
      token("set-var(txn.foo,ifnotempty) var(txn.foo) unset-var(txn.foo) set-var-fmt(txn.id)"),
    );
    expect(hits).toEqual([
      expect.objectContaining({ name: "txn.foo", role: "definition" }),
      expect.objectContaining({ name: "txn.foo", role: "reference" }),
      expect.objectContaining({ name: "txn.foo", role: "reference" }),
      expect.objectContaining({ name: "txn.id", role: "definition" }),
    ]);
  });

  it("does not treat set-var as a var() fetch", () => {
    const hits = findRuntimeVariableHits(token("set-var(txn.path)"));
    expect(hits).toEqual([expect.objectContaining({ name: "txn.path", role: "definition" })]);
  });

  it("finds var() nested in sample expressions and converters", () => {
    const hits = findRuntimeVariableHits(token("%[var(http_host),lower,set-var(txn.host)]"));
    expect(hits.map((hit) => `${hit.role}:${hit.name}`)).toEqual([
      "reference:http_host",
      "definition:txn.host",
    ]);
  });

  it("skips malformed names and keeps argument ranges for completion", () => {
    const incomplete = token("set-var(");
    expect(findRuntimeVariableHits(incomplete)).toEqual([]);
    expect(runtimeVariableArgumentExpectedAt(incomplete, incomplete.end)).toBe(true);

    const trailingDot = token("var(txn.)");
    expect(findRuntimeVariableHits(trailingDot)).toEqual([]);
    expect(
      runtimeVariableArgumentExpectedAt(trailingDot, trailingDot.text.indexOf("txn.") + 4),
    ).toBe(true);

    expect(findRuntimeVariableHits(token("var(txn.foo+)"))).toEqual([]);
    expect(findRuntimeVariableHits(token("var( txn.foo )"))).toEqual([
      expect.objectContaining({ name: "txn.foo", role: "reference" }),
    ]);
    expect(runtimeVariableArgumentExpectedAt(token("path"), 0)).toBe(false);
    expect(runtimeVariableArgumentExpectedAt(token("prefixvar(x)"), 0)).toBe(false);
    expect(runtimeVariableArgumentExpectedAt(token("var(txn.foo)"), 0)).toBe(false);
  });

  it("collects global unparenthesized set-var names", () => {
    const parsed = parseDocument(
      createDocument('global\n    set-var proc.current_state str("starting")'),
      "3.4",
    );
    expect(findUnparenthesizedRuntimeVariable(parsed[1])).toEqual(
      expect.objectContaining({ name: "proc.current_state", role: "definition" }),
    );
    const nameCol = "    set-var proc.current_state".indexOf("proc");
    expect(runtimeVariableNameExpectedAt(parsed[1], 1, nameCol)).toBe(true);
    expect(unparenthesizedRuntimeVariableExpectedAt(parsed[1], 0, nameCol)).toBe(false);
    expect(unparenthesizedRuntimeVariableExpectedAt(parsed[1], 1, nameCol - 1)).toBe(false);
  });

  it("skips invalid unparenthesized names and bare set-var lines", () => {
    const invalid = parseDocument(createDocument("global\n    set-var 1bad value"), "3.4");
    expect(findUnparenthesizedRuntimeVariable(invalid[1])).toBeNull();

    const bare = parseDocument(createDocument("global\n    set-var"), "3.4");
    expect(findUnparenthesizedRuntimeVariable(bare[1])).toBeNull();
    expect(unparenthesizedRuntimeVariableExpectedAt(bare[1], 1, bare[1].tokens[0].end + 1)).toBe(
      true,
    );

    const other = parseDocument(createDocument("global\n    maxconn 100"), "3.4");
    expect(findUnparenthesizedRuntimeVariable(other[1])).toBeNull();
    expect(unparenthesizedRuntimeVariableExpectedAt(other[1], 1, 0)).toBe(false);
  });

  it("ignores sparse tokens when detecting variable name positions", () => {
    const sparse = {
      line: 0,
      section: "frontend",
      tokens: [undefined as never, token("var(txn.host)", 4)],
      isSectionHeader: false,
      anonymousDefaults: false,
    } as ParsedLine;
    expect(runtimeVariableNameExpectedAt(sparse, 1, 8)).toBe(true);
  });
});
