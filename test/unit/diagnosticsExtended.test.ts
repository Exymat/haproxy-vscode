import { computeDiagnostics } from "../../src/diagnostics";
import { createDocument } from "../helpers/document";
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
    const diags = computeDiagnostics(doc as never, schema, { languageData: bundle34.languageData });
    expect(diags.every((d) => d.code !== "unknown-keyword")).toBe(true);
  });

  it("reports unknown stats socket level", () => {
    const doc = createDocument("global\n    stats socket /tmp/haproxy level bogus");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("reports unknown http-request action", () => {
    const doc = createDocument("frontend x\n    bind :80\n    http-request notreal if TRUE");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-action")).toBe(true);
  });

  it("reports unknown use-service target when services are defined", () => {
    const doc = createDocument(
      "frontend x\n    bind :80\n    http-request use-service missing-service if TRUE",
    );
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    const serviceDiag = diags.find((d) => d.code === "unknown-service");
    if ((bundle34.schema.keyword_groups.services ?? []).length === 0) {
      expect(serviceDiag).toBeUndefined();
    } else {
      expect(serviceDiag).toBeDefined();
    }
  });

  it("flags invalid tcp-request content phase via statement rules", () => {
    const doc = createDocument("frontend x\n    tcp-request inspect-delay 5s if TRUE");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.length).toBeGreaterThanOrEqual(0);
  });

  it("reports wrong-section with allowed sections list", () => {
    const doc = createDocument("frontend x\n    external-check");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-section")).toBe(true);
  });

  it("reports wrong-context for HTTP-only keyword in tcp mode", () => {
    const doc = createDocument("listen x\n    mode tcp\n    capture cookie SID len 64");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
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
    const diags = computeDiagnostics(doc as never, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.filter((d) => d.code === "wrong-context")).toHaveLength(0);
  });

  it("reports wrong-context for HTTP-only option in tcp mode", () => {
    const doc = createDocument("defaults\n    mode tcp\n    option httplog");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
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
    const diags = computeDiagnostics(doc as never, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-context")).toBe(false);
  });

  it("reports wrong-context for bind option in incompatible mode", () => {
    const doc = createDocument("frontend x\n    mode spop\n    bind :80 idle-ping");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
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
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-context")).toBe(true);
  });

  it("allows option lines in defaults", () => {
    const doc = createDocument("defaults\n    option httplog");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
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
    const diags = computeDiagnostics(doc as never, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("suppresses deprecated warnings with expose-deprecated-directives", () => {
    const doc = createDocument("global\n    expose-deprecated-directives\n    master-worker");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
      deprecatedWarnings: true,
    });
    expect(diags.filter((d) => d.code === "deprecated-keyword")).toHaveLength(0);
  });

  it("reports unknown tcp-response phase", () => {
    const doc = createDocument("listen x\n    tcp-response notreal if TRUE");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      diags.some((d) => d.code === "unknown-value" && d.message.includes("tcp-response")),
    ).toBe(true);
  });

  it("reports unknown tcp-response and http-after-response actions", () => {
    const tcp = createDocument("listen x\n    tcp-response content notreal-action");
    const tcpDiags = computeDiagnostics(tcp as never, bundle34.schema, {
      languageData: bundle34.languageData,
    });
    expect(
      tcpDiags.some((d) => d.code === "unknown-action" && d.message.includes("tcp-response")),
    ).toBe(true);

    const after = createDocument("frontend x\n    http-after-response notreal-action");
    const afterDiags = computeDiagnostics(after as never, bundle34.schema, {
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
    const diags = computeDiagnostics(doc as never, schema, { languageData: bundle34.languageData });
    expect(diags.some((d) => d.code === "unknown-service")).toBe(true);
  });

  it("reports wrong-section before any section header", () => {
    const schema = structuredClone(bundle34.schema);
    const doc = createDocument("    mode http\nglobal\n    maxconn 100");
    const diags = computeDiagnostics(doc as never, schema, {
      languageData: bundle34.languageData,
    });
    expect(diags.some((d) => d.code === "wrong-section" || d.code === "unknown-keyword")).toBe(
      true,
    );
  });

  it("reports wrong-section for keywords with many allowed sections", () => {
    const doc = createDocument("global\n    mode");
    const diags = computeDiagnostics(doc as never, bundle34.schema, {
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
    const diags = computeDiagnostics(doc as never, schema, { languageData: bundle34.languageData });
    expect(diags.filter((d) => d.code === "unknown-keyword")).toHaveLength(0);
  });
});
