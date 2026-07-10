import { describe, expect, it } from "vitest";

import { lookupConditionalDirective } from "../../src/conditionalDirectives";
import { isOptionLine } from "../../src/optionLine";
import { parseDocumentLines } from "../../src/parser";
import { parseSectionHeader, sectionHeaderFromModifier } from "../../src/sectionUtils";
import { resolveSymbolAtPosition } from "../../src/symbolIndex";
import { unusedSymbolDiagnostics } from "../../src/unusedSymbolDiagnostics";
import { buildSymbolIndex } from "../../src/symbolIndex";
import { collectSampleFetchReferences } from "../../src/symbolIndex/collectors/sampleFetch";
import { DiagnosticContext } from "../../src/diagnosticContext";
import { computeDiagnostics } from "../../src/diagnostics";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";
import { parseDocument } from "../helpers/parse";
import { diagnosticOptions } from "../helpers/diagnostics";

const bundle = loadSchemaBundle("3.4");
const { schema } = bundle;

function pos(line: number, character: number) {
  return { line, character } as never;
}

describe("branch coverage gaps", () => {
  it("uses empty section headers when parse options omit them", () => {
    const parsed = parseDocumentLines(["frontend web\n    bind :80"]);
    expect(parsed[0]?.isSectionHeader).toBe(false);
  });

  it("detects no-option lines without schema-driven rules", () => {
    const line = parseDocumentLines(["    no option httplog"])[0];
    expect(isOptionLine(line)).toBe(true);
    expect(isOptionLine(line, schema)).toBe(true);
  });

  it("returns null when env() references are malformed inside a token", () => {
    const document = createDocument("global\n    http-request deny if { env( ) }");
    const col = "    http-request deny if { env( ) }".indexOf("env");
    expect(resolveSymbolAtPosition(document, pos(1, col), schema)).toBeNull();
  });

  it("covers assorted metadata and parsing fallbacks", () => {
    expect(
      lookupConditionalDirective({ conditionalDirectives: undefined } as never, ".if"),
    ).toBeUndefined();

    const customSchema = structuredClone(schema);
    customSchema.reference_patterns = [
      {
        match_tokens: ["frontend", "*", "using"],
        reference_kind: "defaults-profile",
        target_token_index: 3,
        scope: "section-header",
      },
    ];
    expect(sectionHeaderFromModifier(customSchema)).toBe("using");
    const headerLine = {
      line: 0,
      section: null,
      isSectionHeader: true,
      anonymousDefaults: false,
      tokens: [
        { text: "frontend", start: 0, end: 8 },
        { text: "web", start: 9, end: 12 },
        { text: "using", start: 13, end: 18 },
        { text: "base", start: 19, end: 23 },
      ],
    };
    expect(parseSectionHeader(headerLine, customSchema)?.profileName).toBe("base");

    const customMessagesSchema = structuredClone(schema);
    customMessagesSchema.validation_rules = {
      ...customMessagesSchema.validation_rules,
      unused_symbol_messages: {},
    };
    const unusedDoc = createDocument("frontend web\n    acl orphan path /x");
    const parsed = parseDocument(unusedDoc);
    const index = buildSymbolIndex(parsed, customMessagesSchema);
    const ctx = new DiagnosticContext(unusedDoc, customMessagesSchema, {
      languageData: bundle.languageData,
    });
    expect(unusedSymbolDiagnostics(unusedDoc, parsed, index, ctx, { enabled: true })).not.toEqual(
      [],
    );

    const envDoc = createDocument('global\n    log "$FOO" local0');
    const envCol = '    log "$FOO"'.indexOf("FOO");
    expect(resolveSymbolAtPosition(envDoc, pos(1, envCol), schema)).toEqual({
      kind: "environment-variable",
      name: "FOO",
      scopeKey: null,
    });

    const diagDoc = createDocument("defaults\n    mode http");
    const baseOptions = { ...diagnosticOptions("3.4"), missingReferences: false };
    computeDiagnostics(diagDoc, schema, { ...baseOptions, deprecatedWarnings: true });
    computeDiagnostics(diagDoc, schema, { ...baseOptions, deprecatedWarnings: false });

    const sampleLine = parseDocumentLines(["    set-var txn.x var(other,FOO)"])[0];
    const sampleRefs: import("../../src/symbolIndex/types").SymbolSite[] = [];
    collectSampleFetchReferences(sampleLine, null, sampleRefs, {
      var: {
        reference_kind: "environment-variable",
        argument_index: 1,
        scope: "global",
      },
    });
    expect(sampleRefs.some((ref) => ref.name === "FOO")).toBe(true);

    const sparseArgsLine = parseDocumentLines(["    var(a)"])[0];
    const sparseRefs: import("../../src/symbolIndex/types").SymbolSite[] = [];
    collectSampleFetchReferences(sparseArgsLine, null, sparseRefs, {
      var: {
        reference_kind: "environment-variable",
        argument_index: 2,
        scope: "global",
      },
    });
    expect(sparseRefs).toEqual([]);
  });
});
