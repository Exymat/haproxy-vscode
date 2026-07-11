import { DiagnosticContext } from "../../../src/diagnostics/diagnosticContext";
import { computeDiagnostics } from "../../../src/diagnostics";
import type { ParsedLine } from "../../../src/parser";
import { createDocument } from "../../helpers/document";
import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import { loadSchemaBundle } from "../../helpers/schema";

describe("diagnostics settings branches", () => {
  const bundle34 = loadSchemaBundle("3.4");

  it("covers option, service, and prefix-family branches", () => {
    const schema = structuredClone(bundle34.schema);
    schema.sections.defaults = {
      ...schema.sections.defaults,
      keywords: schema.sections.defaults.keywords.filter((kw) => kw !== "option"),
    };
    expect(
      computeDiagnostics(createDocument("defaults\n    option httplog"), schema, {
        languageData: bundle34.languageData,
      }).filter((d) => d.code === "unknown-keyword"),
    ).toHaveLength(0);

    const serviceSchema = structuredClone(bundle34.schema);
    serviceSchema.keyword_groups.services = ["known-service"];
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    bind :80\n    http-request use-service missing if TRUE"),
        serviceSchema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-service"),
    ).toBe(true);

    const prefixSchema = structuredClone(bundle34.schema);
    prefixSchema.line_layout = {
      ...(prefixSchema.line_layout ?? {}),
      prefix_families: ["customprefix"],
      prefix_subcommands: { customprefix: ["enable", "scope"] },
    };
    expect(
      computeDiagnostics(createDocument("global\n    customprefix bogus"), prefixSchema, {
        languageData: bundle34.languageData,
      }).some((d) => d.code === "unknown-keyword"),
    ).toBe(true);
  });

  it("covers valid service, prefix, and option paths", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keyword_groups.services = ["known-service"];
    const valid = createDocument(
      [
        "global",
        "    stats socket /tmp/haproxy level admin",
        "frontend x",
        "    bind :80",
        "    http-request use-service lua.custom",
      ].join("\n"),
    );
    const diags = computeDiagnostics(valid, schema, { languageData: bundle34.languageData });
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "unknown-service")).toHaveLength(0);
    expect(
      computeDiagnostics(createDocument("backend x\n    http-check connect"), bundle34.schema, {
        languageData: bundle34.languageData,
      }).filter((d) => d.code === "unknown-keyword" && d.message.includes("subcommand")),
    ).toEqual([]);
  });

  it("covers option forms, phases, and missing metadata branches", () => {
    expect(
      computeDiagnostics(
        createDocument("defaults\n    option notreal\n    no option notreal"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).filter((d) => d.code === "unknown-option"),
    ).toHaveLength(2);
    const phaseSchema = structuredClone(bundle34.schema);
    phaseSchema.keywords["tcp-request"] = {
      ...(phaseSchema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    phaseSchema.keyword_groups.tcp_request_actions = [
      ...(phaseSchema.keyword_groups.tcp_request_actions ?? []),
      "accept",
    ];
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    tcp-request accept if TRUE"),
        phaseSchema,
        { languageData: bundle34.languageData },
      ).filter((d) => d.code === "unknown-value"),
    ).toHaveLength(0);
    expect(
      computeDiagnostics(
        createDocument("defaults\n    mode tcp\n    no option httplog"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(true);

    const noRuleSchema = structuredClone(bundle34.schema);
    noRuleSchema.statement_rules = [];
    noRuleSchema.keywords["tcp-request"] = {
      name: "tcp-request",
      sections: ["frontend"],
      signatures: ["tcp-request <phase> [args]"],
      sources: [],
    };
    noRuleSchema.keywords["http-request"] = {
      name: "http-request",
      sections: ["frontend"],
      signatures: ["http-request <action> [args]"],
      sources: [],
    };
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    tcp-request strangephase if TRUE"),
        noRuleSchema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-value"),
    ).toBe(false);
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    http-request strangeaction"),
        noRuleSchema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-action"),
    ).toBe(false);
  });

  it("covers deprecated and unused-symbol settings", () => {
    expect(
      computeDiagnostics(
        createDocument("global\n    expose-deprecated-directives\n    master-worker"),
        bundle34.schema,
        { languageData: bundle34.languageData, deprecatedWarnings: true },
      ).filter((d) => d.code === "deprecated-keyword"),
    ).toHaveLength(0);
    expect(
      computeDiagnostics(createDocument("global\n    master-worker"), bundle34.schema, {
        deprecatedWarnings: false,
      }).filter((d) => d.code === "deprecated-keyword"),
    ).toHaveLength(0);

    const converterSchema = structuredClone(bundle34.schema);
    converterSchema.sample_converters = {
      ...converterSchema.sample_converters,
      legacy_conv: {
        name: "legacy_conv",
        signature: "legacy_conv()",
        deprecated: true,
        args: [],
        chapter: "7.3.1",
        contexts: [],
        description: "",
        in_type: "str",
        out_type: "str",
        max_args: 0,
      },
    };
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    http-request set-header X %[src,legacy_conv()]"),
        converterSchema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "deprecated-sample"),
    ).toBe(true);

    const doc = createDocument(
      "frontend web\n    acl blocked path_beg /admin\n    bind :80\nbackend old\n    server s1 127.0.0.1:80",
    );
    expect(
      computeDiagnostics(doc, bundle34.schema, {
        unusedSymbols: true,
        maxLines: 4000,
      }).some((d) => d.code === "unused-section"),
    ).toBe(true);
    const largeDoc = createDocument(
      Array.from({ length: 120 }, (_, i) =>
        i === 0 ? "frontend web" : i === 1 ? "    bind :80" : `    acl a${i} path_beg /${i}`,
      ).join("\n"),
    );
    expect(
      computeDiagnostics(largeDoc, bundle34.schema, { unusedSymbols: true, maxLines: 100 }).filter(
        (d) => formatDiagnosticCode(d.code).startsWith("unused-"),
      ),
    ).toHaveLength(0);
  });

  it("keeps diagnostics stable with deprecated warnings toggled", () => {
    const doc = createDocument("defaults\n    mode http");
    const baseOptions = { languageData: bundle34.languageData, missingReferences: false };

    expect(
      computeDiagnostics(doc, bundle34.schema, { ...baseOptions, deprecatedWarnings: true }),
    ).toEqual([]);
    expect(
      computeDiagnostics(doc, bundle34.schema, { ...baseOptions, deprecatedWarnings: false }),
    ).toEqual([]);
  });
});

describe("DiagnosticContext branches", () => {
  const bundle34 = loadSchemaBundle("3.4");

  it("omits deprecated index when deprecated warnings are disabled", () => {
    const ctx = new DiagnosticContext(
      createDocument("global\n    master-worker"),
      bundle34.schema,
      {
        deprecatedWarnings: false,
      },
    );
    expect(ctx.deprecatedIndex).toBeUndefined();
    expect(ctx.suppressDeprecated).toBe(false);
  });

  it("returns empty line text for out-of-range parsed lines", () => {
    const ctx = new DiagnosticContext(createDocument("global"), bundle34.schema);
    const missingLine = {
      line: 42,
      section: "global",
      tokens: [{ text: "mode", start: 0, end: 4 }],
      isSectionHeader: false,
      anonymousDefaults: false,
      textLength: 4,
    } satisfies ParsedLine;
    expect(ctx.lineText(missingLine)).toBe("");
  });
});
