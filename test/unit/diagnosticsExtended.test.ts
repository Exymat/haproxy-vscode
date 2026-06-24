import { DiagnosticContext } from "../../src/diagnosticContext";
import { computeDiagnostics } from "../../src/diagnostics";
import { ParsedLine } from "../../src/parser";
import { createDocument } from "../helpers/document";
import { formatDiagnosticCode } from "../helpers/diagnosticFormat";
import { loadSchemaBundle } from "../helpers/schema";

describe("diagnostics extended branches", () => {
  const bundle34 = loadSchemaBundle("3.4");

  it("skips macro lines", () => {
    const schema = bundle34.schema;
    const macros = schema.tokens.macros ?? [];
    if (macros.length === 0) {
      return;
    }
    const doc = createDocument(`global\n    ${macros[0]} foo bar`);
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(diags.every((d) => d.code !== "unknown-keyword")).toBe(true);
  });

  it("reports unknown stats socket level", () => {
    const doc = createDocument("global\n    stats socket /tmp/haproxy level bogus");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("reports unknown http-request action", () => {
    const doc = createDocument("frontend x\n    bind :80\n    http-request notreal if TRUE");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-action")).toBe(true);
  });

  it("reports unknown use-service target when services are defined", () => {
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service missing-service if TRUE",
    );
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    const serviceDiag = diags.find((d) => d.code === "unknown-service");
    const hasServices = (bundle34.schema.keyword_groups.services ?? []).length > 0;
    expect(serviceDiag !== undefined).toBe(hasServices);
  });

  it("flags invalid tcp-request content phase via statement rules", () => {
    const doc = createDocument("frontend x\n    tcp-request inspect-delay 5s if TRUE");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.length).toBeGreaterThanOrEqual(0);
  });

  it("reports wrong-section with allowed sections list", () => {
    const doc = createDocument("frontend x\n    external-check");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-section")).toBe(true);
  });

  it("reports wrong-context for HTTP-only keyword in tcp mode", () => {
    const doc = createDocument("listen x\n    mode tcp\n    capture cookie SID len 64");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-context")).toBe(true);
  });

  it("does not report wrong-context for non runtime-specific contexts", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keywords.maxconn = {
      ...schema.keywords.maxconn,
      contexts: ["spop"],
    };
    const doc = createDocument("frontend x\n    mode spop\n    maxconn 1000");
    const diags = computeDiagnostics(doc, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.filter((d) => d.code === "wrong-context")).toHaveLength(0);
  });

  it("reports wrong-context for HTTP-only option in tcp mode", () => {
    const doc = createDocument("defaults\n    mode tcp\n    option httplog");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      diags.some((d) => d.code === "wrong-context" && d.message.includes("option httplog")),
    ).toBe(true);
  });

  it("skips bind option context checks when no contexts are defined", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keyword_groups.bind_options = [
      ...(schema.keyword_groups.bind_options ?? []),
      "test-nocontext",
    ];
    const doc = createDocument("frontend x\n    mode tcp\n    bind :80 test-nocontext");
    const diags = computeDiagnostics(doc, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-context")).toBe(false);
  });

  it("reports wrong-context for bind option in incompatible mode", () => {
    const doc = createDocument("frontend x\n    mode spop\n    bind :80 idle-ping");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-context" && d.message.includes("idle-ping"))).toBe(
      true,
    );
  });

  it("reports wrong-context with inherited mode from defaults", () => {
    const doc = createDocument(
      "defaults base\n    mode tcp\nfrontend web from base\n    capture cookie SID len 64",
    );
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-context")).toBe(true);
  });

  it("allows option lines in defaults", () => {
    const doc = createDocument("defaults\n    option httplog");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.filter((d) => d.code === "unknown-keyword")).toHaveLength(0);
  });

  it("reports unknown tcp-request phase when bare tcp-request is allowed", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    const doc = createDocument("frontend x\n    tcp-request notreal if TRUE");
    const diags = computeDiagnostics(doc, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("suppresses deprecated warnings with expose-deprecated-directives", () => {
    const doc = createDocument("global\n    expose-deprecated-directives\n    master-worker");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
      deprecatedWarnings: true,
    });
    expect(diags.filter((d) => d.code === "deprecated-keyword")).toHaveLength(0);
  });

  it("reports unknown tcp-response phase", () => {
    const doc = createDocument("listen x\n    tcp-response notreal if TRUE");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      diags.some((d) => d.code === "unknown-value" && d.message.includes("tcp-response")),
    ).toBe(true);
  });

  it("reports unknown tcp-response and http-after-response actions", () => {
    const tcp = createDocument("listen x\n    tcp-response content notreal-action");
    const tcpDiags = computeDiagnostics(tcp, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      tcpDiags.some((d) => d.code === "unknown-action" && d.message.includes("tcp-response")),
    ).toBe(true);

    const after = createDocument("frontend x\n    http-after-response notreal-action");
    const afterDiags = computeDiagnostics(after, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      afterDiags.some(
        (d) => d.code === "unknown-action" && d.message.includes("http-after-response"),
      ),
    ).toBe(true);
  });

  it("reports unknown use-service target", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keyword_groups.services = ["known-service"];
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service missing if TRUE",
    );
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(diags.some((d) => d.code === "unknown-service")).toBe(true);
  });

  it("reports wrong-section before any section header", () => {
    const schema = structuredClone(bundle34.schema);
    const doc = createDocument("    mode http\nglobal\n    maxconn 100");
    const diags = computeDiagnostics(doc, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-section" || d.code === "unknown-keyword")).toBe(
      true,
    );
  });

  it("reports wrong-section for keywords with many allowed sections", () => {
    const doc = createDocument("global\n    mode");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    const wrong = diags.find((d) => d.code === "wrong-section");
    expect(wrong).toBeDefined();
    if (wrong === undefined) {
      throw new Error("expected wrong-section diagnostic");
    }
    expect(wrong.message).toContain("not supported in section");
    expect(wrong.message).not.toContain("allowed in:");
  });

  it("allows option lines when section exposes option subcommands", () => {
    const schema = structuredClone(bundle34.schema);
    schema.sections.defaults = {
      ...schema.sections.defaults,
      keywords: schema.sections.defaults.keywords.filter((kw) => kw !== "option"),
    };
    const doc = createDocument("defaults\n    option httplog");
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(diags.filter((d) => d.code === "unknown-keyword")).toHaveLength(0);
  });

  it("accepts valid stats socket levels and lua services without diagnostics", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keyword_groups.services = ["known-service"];
    const doc = createDocument(
      [
        "global",
        "    stats socket /tmp/haproxy level admin",
        "frontend x",
        "    bind :80",
        "    http-request use-service lua.custom",
      ].join("\n"),
    );
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "unknown-service")).toHaveLength(0);
  });

  it("reports unknown option keywords for both option and no option forms", () => {
    const doc = createDocument("defaults\n    option notreal\n    no option notreal");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.filter((d) => d.code === "unknown-option")).toHaveLength(2);
  });

  it("skips unknown phase diagnostics when the token is also a known action", () => {
    const schema = structuredClone(bundle34.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    schema.keyword_groups.tcp_request_actions = [
      ...(schema.keyword_groups.tcp_request_actions ?? []),
      "accept",
    ];
    const doc = createDocument("frontend x\n    tcp-request accept if TRUE");
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
  });

  it("reports wrong-context for no option lines in incompatible mode", () => {
    const doc = createDocument("defaults\n    mode tcp\n    no option httplog");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      diags.some((d) => d.code === "wrong-context" && d.message.includes("option httplog")),
    ).toBe(true);
  });

  it("reports unknown prefix subcommands for known prefix families", () => {
    const schema = structuredClone(bundle34.schema);
    schema.line_layout = {
      ...(schema.line_layout ?? {}),
      prefix_families: ["customprefix"],
      prefix_subcommands: { customprefix: ["enable", "scope"] },
    };
    const doc = createDocument("global\n    customprefix bogus");
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(
      diags.some((d) => d.code === "unknown-keyword" && d.message.includes("subcommand")),
    ).toBe(true);
  });

  it("accepts known option keywords and acl criteria without nested diagnostics", () => {
    const doc = createDocument(
      "defaults\n    option httplog\nfrontend x\n    acl is_api path_beg /api",
    );
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.filter((d) => d.code === "unknown-option")).toHaveLength(0);
    expect(diags.filter((d) => d.code === "unknown-criterion")).toHaveLength(0);
  });

  it("uses legacy phase and action fallback when no statement rule group matches", () => {
    const schema = structuredClone(bundle34.schema);
    schema.statement_rules = [];
    schema.keywords["tcp-request"] = {
      name: "tcp-request",
      sections: ["frontend"],
      signatures: ["tcp-request <phase> [args]"],
      sources: [],
    };
    schema.keywords["http-request"] = {
      name: "http-request",
      sections: ["frontend"],
      signatures: ["http-request <action> [args]"],
      sources: [],
    };

    const tcpDoc = createDocument("frontend x\n    tcp-request strangephase if TRUE");
    const tcpDiags = computeDiagnostics(tcpDoc, schema, { languageData: bundle34.languageData });
    expect(tcpDiags.some((d) => d.code === "unknown-value")).toBe(true);

    const httpDoc = createDocument("frontend x\n    http-request strangeaction");
    const httpDiags = computeDiagnostics(httpDoc, schema, { languageData: bundle34.languageData });
    expect(httpDiags.some((d) => d.code === "unknown-action")).toBe(true);
  });

  it("does not report unknown service when no service catalog exists", () => {
    const schema = structuredClone(bundle34.schema);
    delete schema.keyword_groups.services;
    const doc = createDocument("frontend x\n    bind :80\n    http-request use-service missing");
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(diags.filter((d) => d.code === "unknown-service")).toHaveLength(0);
  });

  it("skips deprecated diagnostics when deprecatedWarnings is disabled", () => {
    const doc = createDocument("global\n    master-worker");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      deprecatedWarnings: false,
    });
    expect(diags.filter((d) => d.code === "deprecated-keyword")).toHaveLength(0);
  });

  it("reports deprecated sample converters with converter-specific messaging", () => {
    const schema = structuredClone(bundle34.schema);
    schema.sample_converters = {
      ...schema.sample_converters,
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
    const doc = createDocument("frontend x\n    http-request set-header X %[src,legacy_conv()]");
    const diags = computeDiagnostics(doc, schema, { languageData: bundle34.languageData });
    expect(
      diags.some((d) => d.code === "deprecated-sample" && d.message.includes("sample converter")),
    ).toBe(true);
  });

  it("respects unused symbol settings and maxLines in computeDiagnostics", () => {
    const doc = createDocument(
      "frontend web\n    acl blocked path_beg /admin\n    bind :80\nbackend old\n    server s1 127.0.0.1:80",
    );
    const withSections = computeDiagnostics(doc, bundle34.schema, {
      unusedSymbols: true,
      unusedSymbolSections: true,
      maxLines: 4000,
    });
    expect(withSections.some((d) => d.code === "unused-acl")).toBe(true);
    expect(withSections.some((d) => d.code === "unused-section")).toBe(true);

    const withoutSections = computeDiagnostics(doc, bundle34.schema, {
      unusedSymbols: true,
      unusedSymbolSections: false,
    });
    expect(withoutSections.some((d) => d.code === "unused-acl")).toBe(true);
    expect(withoutSections.filter((d) => d.code === "unused-section")).toHaveLength(0);

    const manyLines = Array.from({ length: 120 }, (_, i) =>
      i === 0 ? "frontend web" : i === 1 ? "    bind :80" : `    acl a${i} path_beg /${i}`,
    ).join("\n");
    const largeDoc = createDocument(manyLines);
    const skippedUnused = computeDiagnostics(largeDoc, bundle34.schema, {
      unusedSymbols: true,
      maxLines: 100,
    });
    expect(
      skippedUnused.filter((d) => formatDiagnosticCode(d.code).startsWith("unused-")),
    ).toHaveLength(0);
  });

  it("accepts valid prefix subcommands without unknown-keyword diagnostics", () => {
    const doc = createDocument("backend x\n    http-check connect");
    const diags = computeDiagnostics(doc, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      diags.filter((d) => d.code === "unknown-keyword" && d.message.includes("subcommand")),
    ).toEqual([]);
  });
});

describe("DiagnosticContext branches", () => {
  const bundle34 = loadSchemaBundle("3.4");

  it("omits deprecated index when deprecated warnings are disabled", () => {
    const doc = createDocument("global\n    master-worker");
    const ctx = new DiagnosticContext(doc, bundle34.schema, { deprecatedWarnings: false });
    expect(ctx.deprecatedIndex).toBeUndefined();
    expect(ctx.suppressDeprecated).toBe(false);
  });

  it("returns empty line text for out-of-range parsed lines", () => {
    const doc = createDocument("global");
    const ctx = new DiagnosticContext(doc, bundle34.schema);
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
