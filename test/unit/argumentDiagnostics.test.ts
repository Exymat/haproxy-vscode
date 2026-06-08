import { argumentModelDiagnostics } from "../../src/argumentDiagnostics";
import { computeDiagnostics } from "../../src/diagnostics";
import { parseDocument } from "../../src/parser";
import { sectionKeywordSet } from "../../src/schema";
import { createDocument } from "../helpers/document";
import { buildLineDiagnosticMemo } from "../helpers/lineMemo";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");
const bundle32 = loadSchemaBundle("3.2");

function argDiags(content: string, lineNo: number) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  const allowed = sectionKeywordSet(bundle.schema, line.section);
  return argumentModelDiagnostics(
    line,
    bundle.schema,
    buildLineDiagnosticMemo(line, bundle.schema, allowed),
  );
}

function argDiagsForBundle(content: string, lineNo: number, schema: (typeof bundle)["schema"]) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  const allowed = sectionKeywordSet(schema, line.section);
  return argumentModelDiagnostics(line, schema, buildLineDiagnosticMemo(line, schema, allowed));
}

function argDiagsForBundleWithAllowed(
  content: string,
  lineNo: number,
  schema: (typeof bundle)["schema"],
  adjustAllowed: (allowed: Set<string>) => void,
) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  const allowed = sectionKeywordSet(schema, line.section);
  adjustAllowed(allowed);
  return argumentModelDiagnostics(line, schema, buildLineDiagnosticMemo(line, schema, allowed));
}

describe("argumentDiagnostics", () => {
  it("reports missing mode argument", () => {
    const diags = argDiags("defaults\n    mode", 1);
    expect(diags.some((d) => d.code === "missing-argument")).toBe(true);
  });

  it("reports extra mode argument", () => {
    const diags = argDiags("defaults\n    mode http tcp", 1);
    expect(diags.some((d) => d.code === "extra-argument")).toBe(true);
  });

  it("reports unknown mode value", () => {
    const diags = argDiags("defaults\n    mode bogus", 1);
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("reports missing cookie name", () => {
    const diags = argDiags("defaults\n    cookie", 1);
    expect(
      diags.some((d) => d.code === "missing-argument" && d.message.includes("cookie name")),
    ).toBe(true);
  });

  it("reports unknown cookie modifiers", () => {
    const diags = argDiags("defaults\n    cookie JSESSIONID notreal", 1);
    expect(
      diags.some((d) => d.code === "unknown-value" && d.message.includes("cookie modifier")),
    ).toBe(true);
  });

  it("accepts known cookie modifiers", () => {
    const diags = argDiags("defaults\n    cookie JSESSIONID insert indirect", 1);
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
  });

  it("reports unknown balance algorithm and extra args", () => {
    const unknown = argDiags("defaults\n    balance bogus", 1);
    expect(unknown.some((d) => d.code === "unknown-value")).toBe(true);
    const extra = argDiags("defaults\n    balance roundrobin extra arg", 1);
    expect(extra.some((d) => d.code === "extra-argument")).toBe(true);
  });

  it("accepts balance url_param forms", () => {
    expect(argDiags("backend x\n    balance url_param foo", 1)).toEqual([]);
    expect(argDiags("backend x\n    balance url_param foo check_post", 1)).toEqual([]);
  });

  it("reports invalid trailing value for balance url_param", () => {
    const diags = argDiags("backend x\n    balance url_param foo nope", 1);
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("reports missing required argument for balance url_param variant", () => {
    const schemaWithRequiredVariantArg = structuredClone(bundle.schema);
    const variant = schemaWithRequiredVariantArg.keywords["balance url_param"];
    if (!variant?.argument_model) {
      throw new Error("Expected balance url_param argument model in test schema");
    }
    variant.argument_model.min_args = 1;
    variant.argument_model.slots = [{}, {}];
    variant.signatures = ["balance url_param <name>"];

    const diags = argDiagsForBundleWithAllowed(
      "backend x\n    balance url_param",
      1,
      schemaWithRequiredVariantArg,
      (allowed) => allowed.delete("balance url_param"),
    );
    expect(diags.some((d) => d.code === "missing-argument")).toBe(true);
  });

  it("reports extra argument for balance url_param variant", () => {
    const diags = argDiagsForBundleWithAllowed(
      "backend x\n    balance url_param foo check_post trailing",
      1,
      bundle.schema,
      (allowed) => allowed.delete("balance url_param"),
    );
    expect(diags.some((d) => d.code === "extra-argument")).toBe(true);
  });

  it("returns early when balance url_param variant model is unavailable", () => {
    const schemaWithoutVariant = structuredClone(bundle.schema);
    delete schemaWithoutVariant.keywords["balance url_param"];

    const diags = argDiagsForBundleWithAllowed(
      "backend x\n    balance url_param foo",
      1,
      schemaWithoutVariant,
      (allowed) => allowed.delete("balance url_param"),
    );
    expect(diags).toEqual([]);
  });

  it("handles balance url_param conditional and unknown trailing values", () => {
    const schemaWithVariantEnum = structuredClone(bundle.schema);
    const variant = schemaWithVariantEnum.keywords["balance url_param"];
    if (!variant?.argument_model) {
      throw new Error("Expected balance url_param argument model in test schema");
    }
    variant.argument_model.max_args = 2;
    variant.argument_model.slots = [{ enum: ["foo"] }, { enum: ["check_post", "len"] }];

    const conditional = argDiagsForBundleWithAllowed(
      "backend x\n    balance url_param foo 1",
      1,
      schemaWithVariantEnum,
      (allowed) => allowed.delete("balance url_param"),
    );
    expect(conditional).toEqual([]);

    const unknown = argDiagsForBundleWithAllowed(
      "backend x\n    balance url_param foo nope",
      1,
      bundle.schema,
      (allowed) => allowed.delete("balance url_param"),
    );
    expect(unknown.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("reports mysql-check user and mode issues", () => {
    const missingUser = argDiags("defaults\n    option mysql-check user", 1);
    expect(missingUser.some((d) => d.code === "missing-argument")).toBe(true);

    const badMode = argDiags("defaults\n    option mysql-check user haproxy bogus", 1);
    expect(badMode.some((d) => d.code === "unknown-value")).toBe(true);

    const badFirst = argDiags("defaults\n    option mysql-check bogus", 1);
    expect(badFirst.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("skips prefix families and no/default option lines", () => {
    expect(argDiags("global\n    stats show", 1)).toEqual([]);
    expect(argDiags("defaults\n    no option httplog", 1)).toEqual([]);
    expect(argDiags("defaults\n    default-server inter 2s", 1)).toEqual([]);
  });

  it("is wired through computeDiagnostics", () => {
    const doc = createDocument("defaults\n    mode bogus");
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("allows missing args for multi-signature directives", () => {
    const diags = argDiags("frontend web\n    bind", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("allows missing optional cookie modifiers", () => {
    const diags = argDiags("defaults\n    cookie JSESSIONID", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("returns early for empty mysql-check arguments", () => {
    const diags = argDiags("defaults\n    option mysql-check", 1);
    expect(diags).toEqual([]);
  });

  it("rejects host for http-send-name-header", () => {
    const diags = argDiags("listen l1\n    http-send-name-header host", 1);
    expect(diags.some((d) => d.code === "unknown-value")).toBe(true);
  });

  it("accepts host for http-send-name-header on pre-3.4 schemas", () => {
    const diags = argDiagsForBundle(
      "listen l1\n    http-send-name-header host",
      1,
      bundle32.schema,
    );
    expect(diags.some((d) => d.code === "unknown-value")).toBe(false);
  });

  it("returns no diagnostics for empty http-send-name-header args on 3.4+", () => {
    const diags = argDiags("listen l1\n    http-send-name-header", 1);
    expect(diags).toEqual([]);
  });

  it("accepts non-host header names for http-send-name-header", () => {
    const diags = argDiags("listen l1\n    http-send-name-header x-backend-name", 1);
    expect(diags.some((d) => d.code === "unknown-value")).toBe(false);
  });

  it("allows zero-argument directives with min_args 0", () => {
    const diags = argDiags("global\n    busy-polling", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("allows missing args for multi-signature keywords with argument models", () => {
    const diags = argDiags("global\n    description", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("accepts syslog facility on log address form", () => {
    const diags = argDiags("frontend f1\n    log 127.0.0.1 local0", 1);
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
  });

  it("accepts log len format optional groups", () => {
    const diags = argDiags("frontend f1\n    log ring@buf len 2048 format raw local0", 1);
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
  });

  it("skips optional enum slots when a later slot matches", () => {
    const schema = structuredClone(bundle.schema);
    schema.sections.defaults.keywords = [...schema.sections.defaults.keywords, "test-kw"];
    schema.keywords["test-kw"] = {
      name: "test-kw",
      sections: ["defaults"],
      contexts: [],
      signatures: [],
      sources: [],
      arguments: [],
      argument_model: {
        min_args: 1,
        max_args: 2,
        slots: [
          { enum: ["unused"], optional: true },
          { enum: ["alpha", "beta"], optional: false },
        ],
      },
    };
    const diags = argDiagsForBundle("defaults\n    test-kw alpha", 1, schema);
    expect(diags.filter((d) => d.code === "unknown-value")).toHaveLength(0);
  });

  it("returns early when balance keyword has no argument model", () => {
    const schema = structuredClone(bundle.schema);
    delete schema.keywords.balance.argument_model;
    for (const variant of schema.keywords.balance.variants ?? []) {
      delete variant.argument_model;
    }
    const diags = argDiagsForBundle("defaults\n    balance bogus", 1, schema);
    expect(diags).toEqual([]);
  });

  it("returns early when balance keyword has null max_args", () => {
    const schema = structuredClone(bundle.schema);
    delete schema.keywords.balance.argument_model;
    for (const variant of schema.keywords.balance.variants ?? []) {
      variant.argument_model = {
        min_args: 1,
        max_args: null,
        slots: [{ enum: ["roundrobin"] }],
      };
    }
    const diags = argDiagsForBundle("defaults\n    balance bogus", 1, schema);
    expect(diags).toEqual([]);
  });

  it("reports extra argument when slot index reaches max_args with open slots", () => {
    const schema = structuredClone(bundle.schema);
    schema.keywords.mode.argument_model = {
      min_args: 1,
      max_args: 1,
      slots: [
        { enum: ["http", "tcp", "health"], optional: false },
        { enum: [], optional: true },
      ],
    };
    const diags = argDiagsForBundle("defaults\n    mode http extra", 1, schema);
    expect(diags.some((d) => d.code === "extra-argument")).toBe(true);
  });

  it("stops placing args once max_args is reached after skipping optional slots", () => {
    const schema = structuredClone(bundle.schema);
    schema.sections.defaults.keywords = [...schema.sections.defaults.keywords, "test-kw"];
    schema.keywords["test-kw"] = {
      name: "test-kw",
      sections: ["defaults"],
      contexts: [],
      signatures: [],
      sources: [],
      arguments: [],
      argument_model: {
        min_args: 1,
        max_args: 1,
        slots: [
          { enum: [], optional: true },
          { enum: ["alpha", "beta"], optional: false },
        ],
      },
    };
    const diags = argDiagsForBundle("defaults\n    test-kw alpha", 1, schema);
    expect(diags.some((d) => d.code === "extra-argument")).toBe(true);
  });
});
