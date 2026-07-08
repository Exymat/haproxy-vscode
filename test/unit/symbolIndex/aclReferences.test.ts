import { parseDocument } from "../../../src/parser";
import { aclReferenceExpectedAt } from "../../../src/symbolIndex/aclReferences";
import { aclReferenceAt, collectLineSymbolSites } from "../../../src/symbolIndex/build";
import {
  buildSymbolIndex,
  findReferences,
  findSiteAtPosition,
  resolveSymbolAtPosition,
} from "../../../src/symbolIndex";
import { keywordGroupSet, sampleExpressionNameSets } from "../../../src/schema";

import { doc, pos, schema } from "./helpers";

describe("symbolIndex acl references", () => {
  it("tracks acl references introduced by unless and strips leading bang", () => {
    const parsed = parseDocument(
      doc("frontend web\n    acl blocked path_beg /admin\n    http-request deny unless !blocked"),
    );
    const index = buildSymbolIndex(parsed, schema);
    const refs = findReferences(index, "acl", "blocked", "frontend:web");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe("blocked");
  });

  it("does not treat inline sample fetches as acl references", () => {
    const parsed = parseDocument(
      doc("frontend web\n    use_backend www if { var(http_host) -m found }"),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "acl", "var(http_host)", "frontend:web")).toHaveLength(0);
  });

  it("does not register sample-expression use_backend targets as proxy references", () => {
    const parsed = parseDocument(
      doc("frontend web\n    use_backend %[var(http_host)] if { var(http_host) }"),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(
      index.references.some((site) => site.kind === "proxy-section" && site.name.startsWith("%[")),
    ).toBe(false);
  });

  it("tracks acl references inside inline brace blocks", () => {
    const parsed = parseDocument(
      doc(
        "frontend web\n    acl blocked path_beg /admin\n    http-request deny if { blocked -m found }",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "acl", "blocked", "frontend:web")).toHaveLength(1);
  });

  it("tracks chained acl references in implicit-and conditions", () => {
    const parsed = parseDocument(
      doc(
        "frontend web\n    acl is_static path_beg /static/\n    acl is_image path_beg /images/\n    acl is_video path_beg /videos/\n    http-request set-header X-Is-Static if is_static !is_image !is_video\n    http-request set-header X-Is-Image-Or-Video if is_image is_video || !is_static\n    http-request deny if !is_static !is_image !is_video",
      ),
    );
    const index = buildSymbolIndex(parsed, schema);
    expect(findReferences(index, "acl", "is_static", "frontend:web").length).toBeGreaterThanOrEqual(
      3,
    );
    expect(findReferences(index, "acl", "is_image", "frontend:web").length).toBeGreaterThanOrEqual(
      3,
    );
    expect(findReferences(index, "acl", "is_video", "frontend:web").length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("tracks acl references in mixed inline and named conditions", () => {
    const defs =
      "frontend web\n    acl acl_name_1 path_beg /a1\n    acl acl_name_2 path_beg /a2\n    acl acl_name_3 path_beg /a3\n";
    const cases = [
      "    http-request deny if { dst_port -m int 80 } || !acl_name_1 && acl_name_2 !acl_name_3",
      "    http-request deny if { dst_port -m int 80 } || ( !acl_name_1 && acl_name_2 ) !acl_name_3",
      "    http-request deny if { dst_port -m int 80 } || acl_name_1 && acl_name_2 acl_name_3",
      "    http-request deny if !acl_name_1 acl_name_2 { dst_port -m int 80 }",
      "    http-request deny if { dst_port -m int 80 } !acl_name_1 acl_name_2",
    ];
    for (const condition of cases) {
      const index = buildSymbolIndex(parseDocument(doc(defs + condition)), schema);
      expect(findReferences(index, "acl", "acl_name_1", "frontend:web")).toHaveLength(1);
      expect(findReferences(index, "acl", "acl_name_2", "frontend:web")).toHaveLength(1);
      const expectedAcl3Refs = condition.includes("acl_name_3") ? 1 : 0;
      expect(findReferences(index, "acl", "acl_name_3", "frontend:web")).toHaveLength(
        expectedAcl3Refs,
      );
    }
  });

  it("resolves chained acl references for navigation and hover", () => {
    const defs = "frontend web\n    acl acl_name_1 path_beg /a1\n    acl acl_name_2 path_beg /a2\n";
    const condition =
      "    http-request deny if !acl_name_1 acl_name_2 { dst_port -m int 80 } || !acl_name_1";
    const content = defs + condition;
    const document = doc(content);
    const parsed = parseDocument(document);
    const index = buildSymbolIndex(parsed, schema);
    const lineNo = parsed[parsed.length - 1].line;
    const lineText = document.lineAt(lineNo).text;
    const col = (needle: string) => lineText.indexOf(needle);

    for (const [acl, character] of [
      ["acl_name_1", col("acl_name_1")],
      ["acl_name_2", col("acl_name_2")],
    ] as const) {
      expect(resolveSymbolAtPosition(document, pos(lineNo, character), schema)).toEqual({
        kind: "acl",
        name: acl,
        scopeKey: "frontend:web",
      });
      expect(findSiteAtPosition(index, pos(lineNo, character))).toMatchObject({
        kind: "acl",
        name: acl,
        role: "reference",
      });
    }
  });

  it("covers defensive symbol-index helpers directly", () => {
    const line = parseDocument(doc("frontend web\n    http-request deny if acl1"))[1];
    const aclOperators = new Set<string>(
      (schema.symbols?.acl_condition_operators as string[] | undefined) ?? [],
    );
    const fetchNames = sampleExpressionNameSets(schema).fetchNames;
    const aclCriteria = keywordGroupSet(schema, "acl_criteria");
    expect(aclReferenceAt(schema, line, 99, aclOperators, fetchNames, aclCriteria)).toBeNull();

    const gapAfterIf = {
      ...line,
      tokens: [
        { text: "http-request", start: 4, end: 16 },
        { text: "deny", start: 17, end: 21 },
        { text: "if", start: 22, end: 24 },
        undefined as never,
        { text: "acl1", start: 26, end: 30 },
      ],
    };
    expect(
      aclReferenceAt(schema, gapAfterIf as never, 4, aclOperators, fetchNames, aclCriteria),
    ).toBeNull();

    const inlineFetch = parseDocument(
      doc("frontend web\n    http-request deny if { dst_port -m int 80 }"),
    )[1];
    const dstPortIdx = inlineFetch.tokens.findIndex((token) => token.text === "dst_port");
    expect(
      aclReferenceAt(schema, inlineFetch, dstPortIdx, aclOperators, fetchNames, aclCriteria),
    ).toBeNull();

    const inlineAclCriterion = parseDocument(
      doc("frontend web\n    use_backend dynamic if { path_beg /dynamic }"),
    )[1];
    const pathBegIdx = inlineAclCriterion.tokens.findIndex((token) => token.text === "path_beg");
    expect(
      aclReferenceAt(schema, inlineAclCriterion, pathBegIdx, aclOperators, fetchNames, aclCriteria),
    ).toBeNull();

    const varFetch = parseDocument(
      doc("frontend web\n    use_backend www if { var(http_host) -m found }"),
    )[1];
    const varIdx = varFetch.tokens.findIndex((token) => token.text === "var(http_host)");
    expect(
      aclReferenceAt(schema, varFetch, varIdx, aclOperators, fetchNames, aclCriteria),
    ).toBeNull();

    const inBrace = parseDocument(
      doc(
        "frontend web\n    acl blocked path_beg /x\n    http-request deny if { blocked -m found }",
      ),
    )[2];
    const foundIdx = inBrace.tokens.findIndex((token) => token.text === "found");
    expect(
      aclReferenceAt(schema, inBrace, foundIdx, aclOperators, fetchNames, aclCriteria),
    ).toBeNull();

    const afterBrace = parseDocument(
      doc(
        "frontend web\n    acl a1 path_beg /a\n    http-request deny if { dst_port -m int 80 } a1",
      ),
    )[2];
    const a1Idx = afterBrace.tokens.findIndex((token) => token.text === "a1");
    expect(
      aclReferenceAt(schema, afterBrace, a1Idx, aclOperators, fetchNames, aclCriteria)?.name,
    ).toBe("a1");
    expect(
      aclReferenceExpectedAt(schema, afterBrace, a1Idx, aclOperators, fetchNames, aclCriteria),
    ).toBe(true);
    expect(
      aclReferenceExpectedAt(schema, gapAfterIf as never, 3, aclOperators, fetchNames, aclCriteria),
    ).toBe(true);
    expect(
      aclReferenceExpectedAt(
        schema,
        inlineFetch,
        dstPortIdx,
        aclOperators,
        fetchNames,
        aclCriteria,
      ),
    ).toBe(false);
    expect(
      aclReferenceExpectedAt(
        schema,
        inlineAclCriterion,
        pathBegIdx,
        aclOperators,
        fetchNames,
        aclCriteria,
      ),
    ).toBe(false);
    expect(
      aclReferenceExpectedAt(schema, inBrace, foundIdx, aclOperators, fetchNames, aclCriteria),
    ).toBe(false);
    expect(
      aclReferenceExpectedAt(
        schema,
        {
          ...line,
          tokens: [
            { text: "http-request", start: 4, end: 16 },
            { text: "deny", start: 17, end: 21 },
            { text: "if", start: 22, end: 24 },
            { text: "!", start: 25, end: 26 },
          ],
        },
        3,
        aclOperators,
        fetchNames,
        aclCriteria,
      ),
    ).toBe(false);
    expect(
      aclReferenceExpectedAt(
        schema,
        {
          ...line,
          tokens: [
            { text: "http-request", start: 4, end: 16 },
            { text: "deny", start: 17, end: 21 },
            { text: "if", start: 22, end: 24 },
            { text: "&&", start: 25, end: 27 },
          ],
        },
        3,
        aclOperators,
        fetchNames,
        aclCriteria,
      ),
    ).toBe(false);
    const fetchCallLine = parseDocument(
      doc("frontend web\n    http-request deny if { var(http_host) -m found }"),
    )[1];
    const fetchCallIdx = fetchCallLine.tokens.findIndex((token) => token.text === "var(http_host)");
    expect(
      aclReferenceExpectedAt(
        schema,
        fetchCallLine,
        fetchCallIdx,
        aclOperators,
        fetchNames,
        aclCriteria,
      ),
    ).toBe(false);
    expect(
      aclReferenceExpectedAt(
        schema,
        parseDocument(doc("frontend web\n    http-request deny if { a1 "))[1],
        6,
        aclOperators,
        fetchNames,
        aclCriteria,
      ),
    ).toBe(false);

    const sparse = {
      ...line,
      tokens: [{ text: "http_auth()", start: 0, end: 11 }, undefined as never],
    };
    expect(collectLineSymbolSites(sparse as never, schema, "frontend:web")).toEqual([]);

    const malformedFetchSchema = structuredClone(schema);
    malformedFetchSchema.symbols = {
      ...malformedFetchSchema.symbols,
      sample_fetch_references: { http_auth: [], http_auth_group: { argument_index: 0 } },
    };
    expect(
      collectLineSymbolSites(
        {
          ...line,
          tokens: [{ text: "http_auth(users)", start: 0, end: 16 }],
        },
        malformedFetchSchema,
        "frontend:web",
      ),
    ).toEqual([]);

    expect(
      collectLineSymbolSites(
        {
          ...line,
          tokens: [{ text: "http_auth_group(users)", start: 0, end: 22 }],
        },
        malformedFetchSchema,
        "frontend:web",
      ),
    ).toEqual([]);

    const malformedSelfRefSchema = structuredClone(schema);
    malformedSelfRefSchema.symbols = {
      ...malformedSelfRefSchema.symbols,
      self_reference_keywords: { filter: { reference_kind: 1, token_index: 1 } },
    };
    malformedSelfRefSchema.statement_rules = [];
    expect(
      collectLineSymbolSites(
        parseDocument(doc("frontend web\n    filter trace"))[1],
        malformedSelfRefSchema,
        "frontend:web",
      ),
    ).toEqual([]);

    const globalSelfRefSchema = structuredClone(schema);
    globalSelfRefSchema.statement_rules = [];
    globalSelfRefSchema.symbols = {
      ...globalSelfRefSchema.symbols,
      self_reference_keywords: { filter: { reference_kind: "filter" } },
    };
    expect(
      collectLineSymbolSites(
        parseDocument(doc("frontend web\n    filter trace"))[1],
        globalSelfRefSchema,
        "frontend:web",
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "filter",
        name: "trace",
        scopeKey: null,
      }),
    ]);
  });
});
