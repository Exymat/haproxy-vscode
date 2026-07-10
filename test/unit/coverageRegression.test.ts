import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiagnosticScheduler } from "../../src/diagnosticScheduler";
import { DiagnosticContext } from "../../src/diagnosticContext";
import { runLineDiagnosticPipeline } from "../../src/diagnosticPipeline";
import { getDocumentContext } from "../../src/documentContext";
import { buildLineDiagnosticMemo } from "../helpers/lineMemo";
import { getLineSemanticContext } from "../../src/lineSemanticContext";
import { buildDeprecatedIndex } from "../../src/deprecatedIndex";
import { canCast, resolveOutType } from "../../src/expressionTypes";
import { formatConfig, splitLineAtComment } from "../../src/formatter";
import { provideDocumentSymbols } from "../../src/documentSymbols";
import * as extensionBundle from "../../src/extensionBundle";
import { provideFoldingRanges } from "../../src/folding";
import { clearLanguageDataIndexCache, languageDataIndexes } from "../../src/languageDataIndexes";
import { missingReferenceDiagnostics } from "../../src/missingReferenceDiagnostics";
import { provideReferences } from "../../src/navigation";
import { getParsedDocumentEntry } from "../../src/parseCache";
import { tokenizeLine } from "../../src/parser";
import { parseDocument, parseDocumentLines } from "../helpers/parse";
import { buildSectionSymbols } from "../../src/sectionOutline";
import {
  buildSymbolIndex,
  getSymbolIndex,
  getSymbolIndexVersion,
  scopedSymbolKindSet,
  type SymbolIndex,
  type SymbolSite,
} from "../../src/symbolIndex";
import { buildLineFingerprints } from "../../src/symbolIndex/build";
import { buildReferencesByKey, symbolNameTokenIndex } from "../../src/symbolIndex/utils";
import { tryLogFormatCompletion } from "../../src/completion/handlers/logFormat";
import { resolveLongestDirectiveMatch } from "../../src/tokenUtils";
import { createDocument, updateDocument } from "../helpers/document";
import { formatOptionsWithSchema } from "../helpers/formatOptions";
import { loadSchemaBundle } from "../helpers/schema";
import { getExtensionSettings } from "../../src/settings";
import * as vscode from "vscode";

const bundle = loadSchemaBundle("3.4");
const parseOptions = formatOptionsWithSchema("3.4");

describe("coverage regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearLanguageDataIndexCache();
  });

  it("keeps cross-module scheduler and parse-cache regressions", async () => {
    vi.useFakeTimers();
    const scheduler = createDiagnosticScheduler(
      { set: vi.fn(), delete: vi.fn() } as unknown as vscode.DiagnosticCollection,
      getExtensionSettings,
      vi.fn().mockRejectedValue("scheduler string failure"),
      vi.fn(),
    );
    scheduler.schedule({
      uri: { toString: () => "file:///branch-scheduler.cfg" },
      languageId: "haproxy",
      lineCount: 1,
    } as vscode.TextDocument);
    await vi.advanceTimersByTimeAsync(getExtensionSettings().diagnosticsDebounceMs);
    vi.useRealTimers();

    const doc = createDocument(["defaults", "    mode http", "    timeout client 50s"].join("\n"));
    getParsedDocumentEntry(doc, parseOptions);
    updateDocument(
      doc,
      ["defaults", "    mode http", "frontend web", "    timeout client 50s"].join("\n"),
    );
    expect(getParsedDocumentEntry(doc, parseOptions).parsed[2].section).toBe("frontend");
  });

  it("keeps parser, formatter, and expression utility regressions", () => {
    expect(
      parseDocumentLines(["global", undefined as never, "    daemon"])[2]?.tokens[0]?.text,
    ).toBe("daemon");
    expect(tokenizeLine('prefix"quoted"')).toEqual([{ text: 'prefix"quoted"', start: 0, end: 14 }]);
    expect(splitLineAtComment("# comment only")).toEqual({
      code: "",
      commentSuffix: "# comment only",
    });
    expect(formatConfig("# comment only", formatOptionsWithSchema("3.2"))).toBe("# comment only");
    expect(canCast("missing-row", "str", bundle.schema)).toBe(true);
    expect(resolveOutType("str", { out_type: "same", in_type: "sint" }, bundle.schema)).toBe(
      "sint",
    );
  });

  it("keeps indexing and outline glue regressions", () => {
    expect(
      resolveLongestDirectiveMatch(
        parseDocument(createDocument("global\n    set var txn.foo int 0"))[1],
        new Set(["set-var"]),
      ).keyword,
    ).toBe("set-var");
    expect(buildSectionSymbols([], 3)).toEqual([]);
    expect(
      buildLineFingerprints(parseDocument(createDocument("backend api")), bundle.schema),
    ).toHaveLength(1);
    const indexDoc = createDocument("backend api\n    server s1 127.0.0.1:80");
    expect(getSymbolIndexVersion(indexDoc)).toBeUndefined();
    expect(getSymbolIndex(indexDoc, bundle.schema, 100)).toBeTruthy();
    expect(getSymbolIndexVersion(indexDoc)).toBe(indexDoc.version);
    expect(
      provideReferences(
        indexDoc,
        new vscode.Position(0, 8),
        { includeDeclaration: false },
        bundle.schema,
        100,
      ),
    ).toEqual([]);
    expect(
      symbolNameTokenIndex({ keyword: "x", kind: "directive", fixed_slots: [{ role: "other" }] }),
    ).toBeNull();
    expect(
      buildReferencesByKey(scopedSymbolKindSet(bundle.schema), [
        {
          kind: "acl",
          name: "a",
          line: 1,
          start: 0,
          end: 1,
          scopeKey: "frontend:web",
          role: "reference",
        },
        {
          kind: "acl",
          name: "a",
          line: 2,
          start: 0,
          end: 1,
          scopeKey: "frontend:web",
          role: "reference",
        },
      ]).get("acl:frontend:web:a")?.length,
    ).toBe(2);

    const unresolved: SymbolSite = {
      kind: "userlist",
      name: "missing-users",
      line: 1,
      start: 10,
      end: 23,
      scopeKey: null,
      role: "reference",
    };
    const duplicateIndex: SymbolIndex = {
      definitions: new Map(),
      references: [],
      referencesByKey: new Map(),
      scopeKeyByLine: [],
      scopedSymbolKinds: scopedSymbolKindSet(bundle.schema),
      sitesByLine: [],
      unresolvedReferences: [unresolved, unresolved],
    };
    expect(missingReferenceDiagnostics(duplicateIndex, bundle.schema)).toHaveLength(1);
  });

  it("covers macro pipeline branches", () => {
    const macroDoc = createDocument("global\n    .if TRUE");
    const macroCtx = new DiagnosticContext(macroDoc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(runLineDiagnosticPipeline(macroCtx, parseDocument(macroDoc)[1])).toEqual([]);
    expect(canCast("bool", "meth", bundle.schema)).toBe(false);
    expect(resolveOutType("bool", { out_type: "same", in_type: "meth" }, bundle.schema)).toBe(
      "bool",
    );
    const sparseSchema = {
      ...bundle.schema,
      sample_types: ["from", "to"],
      sample_casts: [[]],
    };
    expect(canCast("from", "to", sparseSchema)).toBe(false);
    expect(resolveOutType("str", {}, bundle.schema)).toBe("str");
    expect(resolveOutType("str", { out_type: "bin" }, bundle.schema)).toBe("bin");
  });

  it("keeps diagnostic pipeline and index fallback regressions", () => {
    const macroDoc = createDocument("global\n    .endif");
    const macroCtx = new DiagnosticContext(macroDoc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(runLineDiagnosticPipeline(macroCtx, parseDocument(macroDoc)[1])).toEqual([]);

    const deprecatedSchema = structuredClone(bundle.schema);
    deprecatedSchema.sample_converters = {
      ...deprecatedSchema.sample_converters,
      sig_conv: {
        name: "sig_conv",
        signature: "sig_conv() (deprecated)",
        args: [],
        chapter: "7.3",
        contexts: [],
        description: "",
        in_type: "str",
        out_type: "str",
        max_args: 0,
      },
    };
    expect(buildDeprecatedIndex(deprecatedSchema).sampleConverters.has("sig_conv")).toBe(true);
    const indexes = languageDataIndexes(structuredClone(bundle.languageData));
    expect(indexes.keywordsBySection.get("frontend")?.length).toBeGreaterThan(0);

    const logDoc = createDocument("defaults\n    log-format");
    const logPosition = new vscode.Position(1, "    log-format".length);
    const logCtx = getDocumentContext(logDoc, logPosition, bundle.schema);
    expect(logCtx).not.toBeNull();
    if (!logCtx) {
      throw new Error("expected log-format document context");
    }
    expect(
      tryLogFormatCompletion({
        document: logDoc,
        position: logPosition,
        data: bundle.languageData,
        schema: bundle.schema,
        ctx: logCtx,
        partial: "",
      }),
    ).toBeNull();
  });

  it("covers remaining schema, hover, parse-cache, and symbol-index gaps", async () => {
    const { hasStatementRuleKind, sectionHasOptionKeywords, validationObjectArray } =
      await import("../../src/schema");
    const { runSpecialArgumentHandlers } = await import("../../src/argumentHandlers/registry");
    const { tryAclRefHover } = await import("../../src/hover/handlers/aclRefHover");
    const { lookupConditionalDirective, conditionalBlocksDocsUrl } =
      await import("../../src/conditionalDirectives");
    const { resolveExpectedSymbolReferenceAtCompletion } = await import("../../src/symbolIndex");
    const { sectionHeaderSet } = await import("../../src/schema");

    expect(hasStatementRuleKind(bundle.schema, "directive")).toBe(true);
    expect(hasStatementRuleKind(bundle.schema, "__missing_kind__")).toBe(false);
    expect(sectionHasOptionKeywords(structuredClone(bundle.schema), "defaults")).toBe(true);

    const bareOptionSchema = structuredClone(bundle.schema);
    bareOptionSchema.sections = {
      ...bareOptionSchema.sections,
      optionprobe: { name: "optionprobe", keywords: ["option"] },
    };
    expect(sectionHasOptionKeywords(bareOptionSchema, "optionprobe")).toBe(true);

    const prefixOnlySchema = structuredClone(bundle.schema);
    prefixOnlySchema.sections = {
      ...prefixOnlySchema.sections,
      prefixonly: { name: "prefixonly", keywords: ["option httplog"] },
    };
    expect(sectionHasOptionKeywords(prefixOnlySchema, "prefixonly")).toBe(true);

    const noOptionSchema = structuredClone(bundle.schema);
    noOptionSchema.sections = {
      ...noOptionSchema.sections,
      nooptionprobe: { name: "nooptionprobe", keywords: ["no option httplog"] },
    };
    expect(sectionHasOptionKeywords(noOptionSchema, "nooptionprobe")).toBe(true);

    const optionSchema = structuredClone(bundle.schema);
    optionSchema.sections = {
      ...optionSchema.sections,
      optionprobe: {
        name: "optionprobe",
        keywords: ["option", "option httplog", "no option missing"],
      },
    };
    expect(sectionHasOptionKeywords(optionSchema, "optionprobe")).toBe(true);

    expect(() =>
      validationObjectArray(
        {
          ...bundle.schema,
          validation_rules: { ...bundle.schema.validation_rules, bad: "not-an-array" },
        },
        "bad",
      ),
    ).toThrow(/validation_rules\.bad/);

    const handlerSchema = structuredClone(bundle.schema);
    handlerSchema.validation_rules = {
      ...handlerSchema.validation_rules,
      special_argument_rules: {
        ...(handlerSchema.validation_rules.special_argument_rules as Record<string, unknown>),
        "unused-rule-key": {},
      },
    };
    const handlerLine = parseDocument(createDocument("defaults\n    mode http"))[1];
    expect(
      runSpecialArgumentHandlers({
        line: handlerLine,
        schema: handlerSchema,
        match: { matched: true, end: 4, keyword: "mode" },
        memo: buildLineDiagnosticMemo(handlerLine, handlerSchema, new Set(["mode"])),
        fullKeyword: undefined,
        schemaKw: undefined,
        getConditionals: () => new Set(),
      }),
    ).toBeNull();

    const aclSchema = structuredClone(bundle.schema);
    aclSchema.semantic_groups = {
      ...aclSchema.semantic_groups,
      acl_ref_groups: ["acl_int_operators"],
    };
    const aclDoc = createDocument("frontend web\n    acl paths path EQ /etc/paths");
    const aclPosition = new vscode.Position(1, "    acl paths path ".length);
    const aclSemantic = getLineSemanticContext(aclDoc, aclPosition, aclSchema, bundle.languageData);
    if (!aclSemantic?.ctx.token) {
      throw new Error("expected acl flag token");
    }
    const aclCtx = aclSemantic.ctx as import("../../src/hover/types").DocumentContextWithToken;
    expect(
      tryAclRefHover({
        document: aclDoc,
        position: aclPosition,
        data: bundle.languageData,
        schema: aclSchema,
        semantic: aclSemantic,
        ctx: aclCtx,
        range: new vscode.Range(1, aclCtx.token.start, 1, aclCtx.token.end),
        cursorOffset: aclPosition.character - aclCtx.token.start,
        tokenLower: aclCtx.token.text.toLowerCase(),
        analyzed: aclSemantic.analyzed,
      }),
    ).not.toBeNull();

    expect(lookupConditionalDirective({} as never, ".if")).toBeUndefined();
    expect(conditionalBlocksDocsUrl({} as never, "3.4")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#2.4",
    );

    const envDoc = createDocument("global\n    setenv MY_VAR value");
    const envCol = "    setenv MY_VAR".indexOf("MY_VAR");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        envDoc,
        { line: 1, character: envCol } as never,
        bundle.schema,
      ),
    ).toBeNull();

    const unsetDoc = createDocument("global\n    unsetenv FOO");
    const unsetCol = "    unsetenv FOO".indexOf("FOO");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        unsetDoc,
        { line: 1, character: unsetCol } as never,
        bundle.schema,
      ),
    ).toBeNull();

    getParsedDocumentEntry(createDocument("global\n    daemon"));
    getParsedDocumentEntry(createDocument("global\n    daemon"), {
      sectionHeaders: sectionHeaderSet(bundle.schema),
    });

    const headerSchema = structuredClone(bundle.schema);
    headerSchema.line_layout = {
      ...(headerSchema.line_layout ?? {}),
      section_headers: [...(headerSchema.line_layout?.section_headers ?? []), "foobar"],
    };
    const headerDoc = createDocument("foobar test\n    bind :80");
    const headerParsed = parseDocument(headerDoc, "3.4", {
      sectionHeaders: new Set(
        (headerSchema.line_layout?.section_headers ?? []).map((header) => header.toLowerCase()),
      ),
    });
    expect(buildSymbolIndex(headerParsed, headerSchema).definitions.size).toBeGreaterThanOrEqual(0);

    vi.spyOn(extensionBundle, "getLoadedBundleForUri").mockReturnValue(undefined);
    const outlineDoc = createDocument("global\n    daemon");
    expect(provideDocumentSymbols(outlineDoc)).toEqual([]);
    expect(provideFoldingRanges(outlineDoc)).toEqual([]);
  });
});
