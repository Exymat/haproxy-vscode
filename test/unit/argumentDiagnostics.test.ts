import { argumentModelDiagnostics } from "../../src/argumentDiagnostics";
import { computeDiagnostics } from "../../src/diagnostics";
import { parseDocument } from "../../src/parser";
import { sectionKeywordSet } from "../../src/schema";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");
const bundle32 = loadSchemaBundle("3.2");

function argDiags(content: string, lineNo: number) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  const allowed = sectionKeywordSet(bundle.schema, line.section);
  return argumentModelDiagnostics(line, bundle.schema, allowed);
}

function argDiagsForBundle(content: string, lineNo: number, schema: (typeof bundle)["schema"]) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  const allowed = sectionKeywordSet(schema, line.section);
  return argumentModelDiagnostics(line, schema, allowed);
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

  it("allows zero-argument directives with min_args 0", () => {
    const diags = argDiags("global\n    busy-polling", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("allows missing args for multi-signature keywords with argument models", () => {
    const diags = argDiags("global\n    description", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });
});
