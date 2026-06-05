import {
  findStatementRule,
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
  ruleActionGroup,
  ruleMatchesLine,
} from "../../src/statementLayout";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

function line(content: string) {
  return parseDocument(createDocument(content) as never)[content.includes("\n") ? 1 : 0];
}

describe("statementLayout", () => {
  const bundle = loadSchemaBundle("3.4");

  it("matches plain and prefixed statement rules", () => {
    const httpRule = bundle.schema.statement_rules.find((r) => r.keyword === "http-request");
    expect(httpRule).toBeDefined();
    if (httpRule === undefined) {
      throw new Error("expected http-request statement rule");
    }
    expect(ruleMatchesLine(httpRule, line("    http-request deny if TRUE"))).toBe(true);
    const noOption = bundle.schema.statement_rules.find((r) => r.prefix === "no");
    expect(noOption).toBeDefined();
    if (noOption === undefined) {
      throw new Error("expected no-prefix statement rule");
    }
    expect(ruleMatchesLine(noOption, line("    no option httplog"))).toBe(true);
  });

  it("finds tcp-request rule and resolves token indices from schema", () => {
    const tcpLine = line("    tcp-request content accept if TRUE");
    const rule = findStatementRule(bundle.schema, tcpLine);
    expect(rule?.keyword).toBe("tcp-request");
    expect(resolvePhaseTokenIndex(rule, tcpLine)).toBe(1);
    expect(resolveActionTokenIndex(rule, tcpLine)).toBe(2);
    expect(ruleActionGroup(rule)).toBe("tcp_request_actions");
  });

  it("falls back to legacy action index for unknown rules", () => {
    const httpLine = line("    http-request deny if TRUE");
    expect(resolveActionTokenIndex(undefined, httpLine)).toBe(1);
    expect(resolvePhaseTokenIndex(undefined, httpLine)).toBeNull();
  });

  it("falls back to legacy tcp indices without statement rule", () => {
    const tcpLine = line("    tcp-request content accept if TRUE");
    expect(resolvePhaseTokenIndex(undefined, tcpLine)).toBe(1);
    expect(resolveActionTokenIndex(undefined, tcpLine)).toBe(2);
  });

  it("returns null when rule token indices are out of range", () => {
    const shortLine = line("    http-request");
    const rule = { keyword: "http-request", kind: "http-request", action_token_index: 5 };
    expect(resolveActionTokenIndex(rule as never, shortLine)).toBeNull();
    expect(resolvePhaseTokenIndex({ phase_token_index: 3 } as never, shortLine)).toBeNull();
  });

  it("handles multi-word rule prefixes", () => {
    expect(
      ruleMatchesLine(
        { keyword: "option", prefix: "no option" } as never,
        line("    no option httplog"),
      ),
    ).toBe(true);
    expect(
      ruleMatchesLine(
        { keyword: "x", prefix: "no option extra" } as never,
        line("    no option httplog"),
      ),
    ).toBe(false);
  });

  it("legacy phase index requires at least two tokens", () => {
    expect(resolvePhaseTokenIndex(undefined, line("    tcp-request"))).toBeNull();
    expect(resolveActionTokenIndex(undefined, line("    tcp-request accept if TRUE"))).toBe(1);
  });
});
