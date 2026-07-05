import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiagnosticScheduler } from "../../src/diagnosticScheduler";
import { DiagnosticContext } from "../../src/diagnosticContext";
import { runLineDiagnosticPipeline } from "../../src/diagnosticPipeline";
import { getDocumentContext } from "../../src/documentContext";
import { buildDeprecatedIndex } from "../../src/deprecatedIndex";
import { canCast, resolveOutType } from "../../src/expressionTypes";
import { formatConfig, splitLineAtComment } from "../../src/formatter";
import { clearLanguageDataIndexCache, languageDataIndexes } from "../../src/languageDataIndexes";
import { missingReferenceDiagnostics } from "../../src/missingReferenceDiagnostics";
import { provideReferences } from "../../src/navigation";
import { getParsedDocumentEntry } from "../../src/parseCache";
import { parseDocument, parseDocumentLines, tokenizeLine } from "../../src/parser";
import { buildSectionSymbols } from "../../src/sectionOutline";
import {
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
import { loadSchemaBundle } from "../helpers/schema";
import { getExtensionSettings } from "../../src/settings";
import * as vscode from "vscode";

const bundle = loadSchemaBundle("3.4");

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
    getParsedDocumentEntry(doc);
    updateDocument(
      doc,
      ["defaults", "    mode http", "frontend web", "    timeout client 50s"].join("\n"),
    );
    expect(getParsedDocumentEntry(doc).parsed[2].section).toBe("frontend");
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
    expect(formatConfig("# comment only")).toBe("# comment only");
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
    expect(buildLineFingerprints(parseDocument(createDocument("backend api")), bundle.schema)).toHaveLength(
      1,
    );
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
    expect(missingReferenceDiagnostics(duplicateIndex)).toHaveLength(1);
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
});
