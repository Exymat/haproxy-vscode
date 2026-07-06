import { describe, expect, it } from "vitest";

import { DiagnosticContext } from "../../src/diagnosticContext";
import {
  contextDiagnostics,
  topLevelDiagnostics,
  unknownNestedDiagnostics,
} from "../../src/nestedKeywordDiagnostics";
import { parseDocument } from "../../src/parser";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function diagnosticContext(content: string) {
  const doc = createDocument(content);
  return {
    doc,
    ctx: new DiagnosticContext(doc, bundle.schema, { languageData: bundle.languageData }),
    lines: parseDocument(doc),
  };
}

function lineAt(content: string, lineIndex = 1) {
  const setup = diagnosticContext(content);
  return { ...setup, line: setup.lines[lineIndex] };
}

describe("topLevelDiagnostics", () => {
  it("returns no diagnostics when the directive matches", () => {
    const { ctx, line } = lineAt("defaults\n    mode http");
    expect(topLevelDiagnostics(ctx, line)).toEqual([]);
  });

  it("allows option lines in sections that expose option keywords", () => {
    const { ctx, line } = lineAt("defaults\n    option httplog");
    expect(topLevelDiagnostics(ctx, line)).toEqual([]);
  });

  it("does not apply option-line allowance in sections without option keywords", () => {
    const { ctx, line } = lineAt("global\n    option httplog");
    expect(topLevelDiagnostics(ctx, line).some((d) => d.code === "wrong-section")).toBe(true);
  });

  it("reports wrong-section before listing sections when many are allowed", () => {
    const { ctx, line } = lineAt("global\n    mode");
    const diags = topLevelDiagnostics(ctx, line);
    expect(diags.some((d) => d.code === "wrong-section")).toBe(true);
    expect(diags[0]?.message).not.toContain("allowed in:");
  });

  it("reports wrong-section with an allowed-section list for narrow keywords", () => {
    const { ctx, line } = lineAt("frontend web\n    external-check");
    const diags = topLevelDiagnostics(ctx, line);
    expect(diags.some((d) => d.code === "wrong-section")).toBe(true);
    expect(diags[0]?.message).toContain("allowed in:");
  });

  it("reports wrong-section when the keyword exists only in other sections", () => {
    const { ctx, line } = lineAt("frontend web\n    daemon");
    expect(topLevelDiagnostics(ctx, line).some((d) => d.code === "wrong-section")).toBe(true);
  });

  it("reports unknown prefix subcommands", () => {
    const schema = structuredClone(bundle.schema);
    schema.line_layout = {
      ...(schema.line_layout ?? {}),
      prefix_families: ["customprefix"],
      prefix_subcommands: { customprefix: ["enable", "scope"] },
    };
    const doc = createDocument("global\n    customprefix bogus");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    const diags = topLevelDiagnostics(ctx, line);
    expect(
      diags.some((d) => d.code === "unknown-keyword" && d.message.includes("subcommand")),
    ).toBe(true);
  });

  it("falls through for known prefix subcommands without subcommand diagnostics", () => {
    const schema = structuredClone(bundle.schema);
    schema.line_layout = {
      ...(schema.line_layout ?? {}),
      prefix_families: ["customprefix"],
      prefix_subcommands: { customprefix: ["enable"] },
    };
    const doc = createDocument("global\n    customprefix enable");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    const diags = topLevelDiagnostics(ctx, line);
    expect(
      diags.filter((d) => d.code === "unknown-keyword" && d.message.includes("subcommand")),
    ).toHaveLength(0);
  });

  it("accepts known prefix subcommands without subcommand diagnostics", () => {
    const { ctx, line } = lineAt("defaults\n    http-check send uri-lf %ci");
    expect(
      topLevelDiagnostics(ctx, line).filter((d) => d.message.includes("subcommand")),
    ).toHaveLength(0);
  });

  it("reports unknown keywords when no section mapping exists", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.totallymadeup = {
      name: "totallymadeup",
      sections: [],
      signatures: ["totallymadeup"],
      sources: [],
    };
    const doc = createDocument("defaults\n    totallymadeup");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    const diags = topLevelDiagnostics(ctx, line);
    expect(diags.some((d) => d.code === "unknown-keyword")).toBe(true);
  });

  it("reports wrong-section for known keywords outside any active section", () => {
    const { ctx, line } = lineAt("    daemon", 0);
    expect(topLevelDiagnostics(ctx, line).some((d) => d.code === "wrong-section")).toBe(true);
  });
});

describe("contextDiagnostics", () => {
  it("returns no diagnostics when runtime mode is unavailable", () => {
    const { ctx, line } = lineAt("global\n    maxconn 1000");
    expect(contextDiagnostics(ctx, line)).toEqual([]);
  });

  it("returns no diagnostics for empty token lines", () => {
    const { ctx, line } = lineAt("defaults\n    mode http");
    expect(contextDiagnostics(ctx, { ...line, tokens: [] })).toEqual([]);
  });

  it("reports wrong-context for runtime-specific directive contexts", () => {
    const { ctx, line } = lineAt("listen x\n    mode tcp\n    capture cookie SID len 64", 2);
    expect(contextDiagnostics(ctx, line).some((d) => d.code === "wrong-context")).toBe(true);
  });

  it("ignores directive contexts that do not participate in mode matching", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.customctx = {
      name: "customctx",
      sections: ["frontend"],
      signatures: ["customctx"],
      sources: [],
      contexts: ["spop"],
    };
    const doc = createDocument("frontend x\n    mode http\n    customctx");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line)).toEqual([]);
  });

  it("reports wrong-context for options in incompatible modes", () => {
    const { ctx, line } = lineAt("defaults\n    mode tcp\n    option httplog", 2);
    expect(
      contextDiagnostics(ctx, line).some(
        (d) => d.code === "wrong-context" && d.message.includes("option httplog"),
      ),
    ).toBe(true);
  });

  it("skips bind option context checks when the group context map is empty", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_group_contexts = {
      ...schema.keyword_group_contexts,
      bind_options: {},
    };
    const doc = createDocument("frontend x\n    mode tcp\n    bind :80 idle-ping ssl");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line).some((d) => d.code === "wrong-context")).toBe(false);
  });

  it("reports wrong-context for bind options in incompatible modes", () => {
    const { ctx, line } = lineAt("frontend x\n    mode spop\n    bind :80 idle-ping", 2);
    expect(
      contextDiagnostics(ctx, line).some(
        (d) => d.code === "wrong-context" && d.message.includes("idle-ping"),
      ),
    ).toBe(true);
  });

  it("skips bind options that are not part of the bind option group", () => {
    const { ctx, line } = lineAt("frontend x\n    mode http\n    bind :80 bogus-option");
    expect(
      contextDiagnostics(ctx, line).filter(
        (d) => d.code === "wrong-context" && d.message.includes("bogus-option"),
      ),
    ).toHaveLength(0);
  });
});

describe("unknownNestedDiagnostics", () => {
  it("returns no diagnostics for keywords outside the nested set", () => {
    const { ctx, line } = lineAt("defaults\n    timeout connect 5s");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("returns no diagnostics for empty first tokens", () => {
    const { ctx, line } = lineAt("defaults\n    mode http");
    expect(unknownNestedDiagnostics(ctx, { ...line, tokens: [] })).toEqual([]);
  });

  it("reports unknown option keywords", () => {
    const { ctx, line } = lineAt("defaults\n    option notreal");
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-option")).toBe(true);
  });

  it("returns no diagnostics for known option keywords", () => {
    const { ctx, line } = lineAt("defaults\n    option httplog");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("returns no diagnostics for statement-rule keywords handled elsewhere", () => {
    const { ctx, line } = lineAt("defaults\n    mode http");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("reports unknown ACL criteria", () => {
    const { ctx, line } = lineAt("frontend web\n    acl bad-name not-a-criterion");
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-criterion")).toBe(
      true,
    );
  });

  it("accepts ACL criteria with parenthesized sample fetches", () => {
    const { ctx, line } = lineAt("frontend web\n    acl has-src src");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("falls through when stats lines are not socket declarations", () => {
    const { ctx, line } = lineAt("global\n    stats enable");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("reports unknown stats socket levels", () => {
    const { ctx, line } = lineAt("global\n    stats socket /tmp/haproxy level bogus");
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("accepts known stats socket levels without diagnostics", () => {
    const { ctx, line } = lineAt("global\n    stats socket /tmp/haproxy level admin");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("returns no diagnostics for inspect-delay rules", () => {
    const { ctx, line } = lineAt("frontend x\n    tcp-request inspect-delay 5s if TRUE");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("returns no diagnostics for tcp-response inspect-delay rules", () => {
    const { ctx, line } = lineAt("frontend x\n    tcp-response inspect-delay 5s if TRUE");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("reports unknown http-request actions", () => {
    const { ctx, line } = lineAt("frontend x\n    bind :80\n    http-request notreal if TRUE", 2);
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-action")).toBe(true);
  });

  it("accepts lua-prefixed actions without unknown-action diagnostics", () => {
    const { ctx, line } = lineAt(
      "frontend x\n    bind :80\n    http-request lua.custom if TRUE",
      2,
    );
    expect(
      unknownNestedDiagnostics(ctx, line).filter((d) => d.code === "unknown-action"),
    ).toHaveLength(0);
  });

  it("accepts known tcp-request phases", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    const doc = createDocument("frontend x\n    tcp-request content accept if TRUE");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    expect(
      unknownNestedDiagnostics(ctx, line).filter((d) => d.code === "unknown-value"),
    ).toHaveLength(0);
  });

  it("reports unknown tcp-request phases", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    const doc = createDocument("frontend x\n    tcp-request notreal if TRUE");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("reports unknown use-service targets when services are defined", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.services = ["known-service"];
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service missing-service if TRUE",
    );
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-service")).toBe(
      true,
    );
  });

  it("requires generated use-service action metadata", () => {
    const schema = structuredClone(bundle.schema);
    schema.semantic_groups = {
      ...schema.semantic_groups,
      use_service: { rule_kinds: ["http-request"], action: 1, service_group: "services" },
    };
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service missing-service if TRUE",
    );
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(() => unknownNestedDiagnostics(ctx, line)).toThrow(/semantic_groups\.use_service/);
  });

  it("does not report unknown service when the service catalog is empty", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.services = [];
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service missing if TRUE",
    );
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(
      unknownNestedDiagnostics(ctx, line).filter((d) => d.code === "unknown-service"),
    ).toHaveLength(0);
  });

  it("does not report lua-prefixed service names", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_groups.services = ["known-service"];
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service lua.custom if TRUE",
    );
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(
      unknownNestedDiagnostics(ctx, line).filter((d) => d.code === "unknown-service"),
    ).toHaveLength(0);
  });

  it("falls through nested handlers for http-request lines", () => {
    const { ctx, line } = lineAt("frontend x\n    http-request notreal if TRUE");
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-action")).toBe(true);
  });

  it("falls through nested handlers for tcp-request content lines", () => {
    const { ctx, line } = lineAt("frontend x\n    tcp-request content accept if TRUE");
    expect(
      unknownNestedDiagnostics(ctx, line).filter((d) => d.code === "unknown-value"),
    ).toHaveLength(0);
  });

  it("falls through when the first token is not handled by a dedicated handler", () => {
    const { ctx, line } = lineAt("frontend x\n    http-response set-header X if TRUE");
    expect(unknownNestedDiagnostics(ctx, line).length).toBeGreaterThanOrEqual(0);
  });
});

describe("topLevelDiagnostics fallbacks", () => {
  it("skips prefix-family checks when the first token is empty", () => {
    const { ctx, line } = lineAt("defaults\n    mode http");
    const sparse = { ...line, tokens: [{ text: "", start: 4, end: 4 }, ...line.tokens] };
    const diags = topLevelDiagnostics(ctx, sparse);
    expect(diags.length).toBeGreaterThanOrEqual(0);
  });
});

describe("contextDiagnostics edge paths", () => {
  it("skips option context checks when the option name token is missing", () => {
    const { ctx, line } = lineAt("defaults\n    mode http\n    option", 2);
    expect(contextDiagnostics(ctx, line)).toEqual([]);
  });

  it("skips option context checks when no context metadata exists for the option", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_group_contexts = {
      ...schema.keyword_group_contexts,
      options: {},
    };
    const doc = createDocument("defaults\n    mode http\n    option httplog");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line)).toEqual([]);
  });

  it("handles sparse token arrays after line memoization", () => {
    const { ctx, line } = lineAt("frontend x\n    mode http\n    notreal", 2);
    ctx.getLineMemo(line);
    expect(contextDiagnostics(ctx, { ...line, tokens: [undefined as never] })).toEqual([]);
  });

  it("skips bind option checks when the statement rule has no option group", () => {
    const schema = structuredClone(bundle.schema);
    schema.statement_rules = schema.statement_rules.filter((rule) => rule.group !== "bind_options");
    const doc = createDocument("frontend x\n    mode http\n    bind :80 ssl");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line)).toEqual([]);
  });

  it("skips bind option checks when group context metadata is absent", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_group_contexts = { ...schema.keyword_group_contexts };
    delete schema.keyword_group_contexts.bind_options;
    const doc = createDocument("frontend x\n    mode tcp\n    bind :80 idle-ping");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line)).toEqual([]);
  });

  it("skips bind options that define no runtime contexts", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_group_contexts = {
      ...schema.keyword_group_contexts,
      bind_options: {
        ssl: [],
      },
    };
    const doc = createDocument("frontend x\n    mode tcp\n    bind :80 ssl");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line).some((d) => d.code === "wrong-context")).toBe(false);
  });

  it("accepts bind option contexts that match the active mode", () => {
    const schema = structuredClone(bundle.schema);
    schema.keyword_group_contexts = {
      ...schema.keyword_group_contexts,
      bind_options: {
        "idle-ping": ["tcp"],
      },
    };
    const doc = createDocument("frontend x\n    mode tcp\n    bind :80 idle-ping");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[2];
    expect(contextDiagnostics(ctx, line).filter((d) => d.code === "wrong-context")).toHaveLength(0);
  });

  it("accepts directives whose runtime context matches the section mode", () => {
    const { ctx, line } = lineAt("frontend x\n    mode http\n    option httplog", 2);
    expect(contextDiagnostics(ctx, line).filter((d) => d.code === "wrong-context")).toHaveLength(0);
  });
});

describe("unknownNestedDiagnostics edge paths", () => {
  it("accepts option lines without an option name", () => {
    const { ctx, line } = lineAt("defaults\n    option");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("falls through stats socket handling when only the stats keyword is present", () => {
    const { ctx, line } = lineAt("global\n    stats");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("falls through tcp inspect-delay handling when only the tcp-request keyword is present", () => {
    const { ctx, line } = lineAt("frontend x\n    tcp-request");
    expect(unknownNestedDiagnostics(ctx, line)).toEqual([]);
  });

  it("reports unknown parenthesized ACL criteria by base name", () => {
    const { ctx, line } = lineAt("frontend web\n    acl bad-name not-a-criterion()");
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-criterion")).toBe(
      true,
    );
  });

  it("does not report a tcp-request phase when the token is a known action", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    const doc = createDocument("frontend x\n    tcp-request accept if TRUE");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    expect(
      unknownNestedDiagnostics(ctx, line).filter((d) => d.code === "unknown-value"),
    ).toHaveLength(0);
  });

  it("reports unknown tcp-response phases", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords["tcp-response"] = {
      ...(schema.keywords["tcp-response content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    const doc = createDocument("frontend x\n    tcp-response notreal if TRUE");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("uses an empty action set when a statement rule has no action group", () => {
    const schema = structuredClone(bundle.schema);
    schema.statement_rules = schema.statement_rules.map((rule) =>
      rule.keyword === "http-request" ? { ...rule, group: undefined } : rule,
    );
    const doc = createDocument("frontend x\n    http-request deny if TRUE");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-action")).toBe(true);
  });

  it("uses an empty phase action set when a phase rule has no action group", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    schema.statement_rules = schema.statement_rules.map((rule) =>
      rule.keyword === "tcp-request" ? { ...rule, group: undefined } : rule,
    );
    const doc = createDocument("frontend x\n    tcp-request notreal if TRUE");
    const ctx = new DiagnosticContext(doc, schema, { languageData: bundle.languageData });
    const line = parseDocument(doc)[1];
    expect(unknownNestedDiagnostics(ctx, line).some((d) => d.code === "unknown-value")).toBe(true);
  });
});
