import { computeDiagnostics } from "../../src/diagnostics";
import { createDocument, updateDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

describe("diagnostics core branches", () => {
  const bundle34 = loadSchemaBundle("3.4");

  it("covers macro, stats, action, and service diagnostics", () => {
    const macros = bundle34.schema.tokens.macros ?? [];
    const macroHasUnknownKeyword =
      macros.length > 0
        ? computeDiagnostics(createDocument(`global\n    ${macros[0]} foo bar`), bundle34.schema, {
            languageData: bundle34.languageData,
          }).some((d) => d.code === "unknown-keyword")
        : false;
    expect(macroHasUnknownKeyword).toBe(false);
    expect(
      computeDiagnostics(
        createDocument("global\n    stats socket /tmp/haproxy level bogus"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-value"),
    ).toBe(true);
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    bind :80\n    http-request notreal if TRUE"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-action"),
    ).toBe(true);
    const serviceDiags = computeDiagnostics(
      createDocument(
        "frontend x\n    bind :80\n    http-request use-service missing-service if TRUE",
      ),
      bundle34.schema,
      { languageData: bundle34.languageData },
    );
    expect(serviceDiags.find((d) => d.code === "unknown-service") !== undefined).toBe(
      (bundle34.schema.keyword_groups.services ?? []).length > 0,
    );
  });

  it("covers wrong-section and wrong-context variants", () => {
    expect(
      computeDiagnostics(createDocument("frontend x\n    external-check"), bundle34.schema, {
        languageData: bundle34.languageData,
      }).some((d) => d.code === "wrong-section"),
    ).toBe(true);
    expect(
      computeDiagnostics(
        createDocument("listen x\n    mode tcp\n    capture cookie SID len 64"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(true);
    const schema = structuredClone(bundle34.schema);
    schema.keywords.maxconn = { ...schema.keywords.maxconn, contexts: ["spop"] };
    expect(
      computeDiagnostics(createDocument("frontend x\n    mode spop\n    maxconn 1000"), schema, {
        languageData: bundle34.languageData,
      }).filter((d) => d.code === "wrong-context"),
    ).toHaveLength(0);
    expect(
      computeDiagnostics(
        createDocument("defaults\n    mode tcp\n    option httplog"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(true);
  });

  it("covers bind-option context and inherited-mode branches", () => {
    const noContextSchema = structuredClone(bundle34.schema);
    noContextSchema.keyword_groups.bind_options = [
      ...(noContextSchema.keyword_groups.bind_options ?? []),
      "test-nocontext",
    ];
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    mode tcp\n    bind :80 test-nocontext"),
        noContextSchema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(false);

    const emptyMapSchema = structuredClone(bundle34.schema);
    emptyMapSchema.keyword_group_contexts = {
      ...emptyMapSchema.keyword_group_contexts,
      bind_options: {},
    };
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    mode tcp\n    bind :80 idle-ping ssl"),
        emptyMapSchema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(false);

    expect(
      computeDiagnostics(
        createDocument("frontend x\n    mode spop\n    bind :80 idle-ping"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(true);
    expect(
      computeDiagnostics(
        createDocument(
          "defaults base\n    mode tcp\nfrontend web from base\n    capture cookie SID len 64",
        ),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-context"),
    ).toBe(true);
  });

  it("covers phase, action, and option subcommand branches", () => {
    expect(
      computeDiagnostics(createDocument("defaults\n    option httplog"), bundle34.schema, {
        languageData: bundle34.languageData,
      }).filter((d) => d.code === "unknown-keyword"),
    ).toHaveLength(0);
    const schema = structuredClone(bundle34.schema);
    schema.keywords["tcp-request"] = {
      ...(schema.keywords["tcp-request content"] ?? { sections: ["frontend"] }),
      sections: ["frontend"],
    };
    expect(
      computeDiagnostics(createDocument("frontend x\n    tcp-request notreal if TRUE"), schema, {
        languageData: bundle34.languageData,
      }).some((d) => d.code === "unknown-value"),
    ).toBe(true);
    expect(
      computeDiagnostics(
        createDocument("listen x\n    tcp-response notreal if TRUE"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-value"),
    ).toBe(true);
    expect(
      computeDiagnostics(
        createDocument("listen x\n    tcp-response content notreal-action"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-action"),
    ).toBe(true);
    expect(
      computeDiagnostics(
        createDocument("frontend x\n    http-after-response notreal-action"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "unknown-action"),
    ).toBe(true);
  });

  it("covers pre-section and section-message branches", () => {
    expect(
      computeDiagnostics(
        createDocument("    mode http\nglobal\n    maxconn 100"),
        bundle34.schema,
        { languageData: bundle34.languageData },
      ).some((d) => d.code === "wrong-section" || d.code === "unknown-keyword"),
    ).toBe(true);
    const wrong = computeDiagnostics(createDocument("global\n    mode"), bundle34.schema, {
      languageData: bundle34.languageData,
    }).find((d) => d.code === "wrong-section");
    expect(wrong?.message).toContain("not supported in section");
    expect(wrong?.message).not.toContain("allowed in:");
  });

  it("reuses diagnostics across URI and line-cache paths", () => {
    const content = ["defaults", "    mode http", "    timeout client 50s"].join("\n");
    const first = createDocument(content, "file:///diagnostics-cache.cfg");
    const firstDiagnostics = computeDiagnostics(first, bundle34.schema, {
      languageData: bundle34.languageData,
      missingReferences: false,
    });
    const reopened = createDocument(content, "file:///diagnostics-cache.cfg");
    expect(
      computeDiagnostics(reopened, bundle34.schema, {
        languageData: bundle34.languageData,
        missingReferences: false,
      }),
    ).toBe(firstDiagnostics);

    updateDocument(first, ["defaults", "    mode tcp", "    timeout client 50s"].join("\n"));
    expect(
      computeDiagnostics(first, bundle34.schema, {
        languageData: bundle34.languageData,
        missingReferences: false,
      }),
    ).toEqual([]);

    const oversized = createDocument("frontend web\n    use_backend missing");
    expect(
      computeDiagnostics(oversized, bundle34.schema, {
        languageData: bundle34.languageData,
        maxLines: 1,
        unusedSymbols: true,
        missingReferences: true,
      }).some((diagnostic) => diagnostic.code === "no-bind-entry-point"),
    ).toBe(true);
  });
});
