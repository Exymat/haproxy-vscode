import {
  candidateRules,
  findStatementRule,
  resolveActionTokenIndex,
  resolvePhaseTokenIndex,
  ruleActionGroup,
  ruleMatchesLine,
} from "../../../src/statementLayout";
import { parseDocument } from "../../helpers/parse";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

function line(content: string) {
  return parseDocument(createDocument(content))[content.includes("\n") ? 1 : 0];
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

  it("returns null action and phase indices when no rule is provided", () => {
    const httpLine = line("    http-request deny if TRUE");
    expect(resolveActionTokenIndex(undefined, httpLine)).toBeNull();
    expect(resolvePhaseTokenIndex(undefined, httpLine)).toBeNull();
  });

  it("returns null tcp indices without statement rule", () => {
    const tcpLine = line("    tcp-request content accept if TRUE");
    expect(resolvePhaseTokenIndex(undefined, tcpLine)).toBeNull();
    expect(resolveActionTokenIndex(undefined, tcpLine)).toBeNull();
  });

  it("returns null when rule token indices are out of range", () => {
    const shortLine = line("    http-request");
    const rule = { keyword: "http-request", kind: "http-request", action_token_index: 5 };
    expect(resolveActionTokenIndex(rule as never, shortLine)).toBeNull();
    expect(resolvePhaseTokenIndex({ phase_token_index: 3 } as never, shortLine)).toBeNull();
  });

  it("handles multi-word rule prefixes", () => {
    expect(candidateRules(bundle.schema, [])).toEqual([]);
    expect(ruleMatchesLine({ keyword: "option" } as never, [])).toBe(false);
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

  it("indexes statement rules by prefix when match tokens are absent", () => {
    const schema = structuredClone(bundle.schema);
    schema.statement_rules = [
      {
        keyword: "option",
        kind: "directive",
        prefix: "no option",
      },
    ];
    expect(findStatementRule(schema, line("    no option httplog"))?.prefix).toBe("no option");
  });

  it("returns null phase and action indices without a rule", () => {
    expect(resolvePhaseTokenIndex(undefined, line("    tcp-request"))).toBeNull();
    expect(resolveActionTokenIndex(undefined, line("    tcp-request accept if TRUE"))).toBeNull();
  });
});
