import * as parseCache from "../../src/parseCache";
import { parseDocument } from "../../src/parser";
import {
  buildSymbolIndex,
  listDefinitionNames,
  resolveExpectedSymbolReferenceAtCompletion,
} from "../../src/symbolIndex";
import { expectedReferenceTesting } from "../../src/symbolIndex/expectedReference";
import { buildScopeKeyByLine } from "../../src/symbolIndex/scope";
import { fetchReferenceRules } from "../../src/symbolIndex/context";
import { HaproxySchema, ReferencePattern } from "../../src/schema";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const { schema } = loadSchemaBundle("3.4");

function requireReferencePattern(
  targetSchema: HaproxySchema,
  firstToken: string,
  secondToken?: string,
): ReferencePattern {
  const pattern = targetSchema.reference_patterns?.find(
    (candidate) =>
      candidate.match_tokens[0] === firstToken &&
      (secondToken === undefined || candidate.match_tokens[1] === secondToken),
  );
  if (!pattern) {
    throw new Error(
      `missing reference pattern: ${firstToken}${secondToken ? ` ${secondToken}` : ""}`,
    );
  }
  return pattern;
}

function pos(line: number, character: number) {
  return { line, character } as never;
}

describe("expectedReference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the parsed line is missing", () => {
    const doc = createDocument("global");
    vi.spyOn(parseCache, "getParsedDocument").mockReturnValue([]);
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(0, 0), schema)).toBeNull();
  });

  it("uses an explicit scopeKeyByLine when provided", () => {
    const content = "frontend web\n    acl one path /one\n    use_backend api if ";
    const doc = createDocument(content);
    const parsed = parseDocument(doc);
    const scopeKeyByLine = buildScopeKeyByLine(parsed, schema);
    const col = "    use_backend api if ".length;
    expect(
      resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), schema, scopeKeyByLine),
    ).toEqual({ kind: "acl", scopeKey: "frontend:web" });
  });

  it("resolves existing token references via resolveSymbolAtPosition", () => {
    const doc = createDocument("backend api\nfrontend web\n    use_backend api");
    const col = "    use_backend api".indexOf("api");
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), schema)).toEqual({
      kind: "proxy-section",
      scopeKey: null,
    });
  });

  it("rejects environment-variable positions", () => {
    const doc = createDocument("global\n    setenv MY_VAR value");
    const col = "    setenv MY_VAR".indexOf("MY_VAR");
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(1, col), schema)).toBeNull();
  });

  it("rejects likely-value backend targets and inherited profile expressions", () => {
    const backendExpr = createDocument("frontend web\n    use_backend %[var(txn.be)]");
    const backendCol = "    use_backend %[var(txn.be)]".indexOf("%[");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(backendExpr, pos(1, backendCol), schema),
    ).toBeNull();

    const profileExpr = createDocument("defaults base\nfrontend web from %[var(x)]");
    const profileCol = "frontend web from %[var(x)]".indexOf("%[");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(profileExpr, pos(1, profileCol), schema),
    ).toBeNull();
  });

  it("rejects section-header positions that are not profile references", () => {
    const doc = createDocument("frontend web from base");
    const fromCol = "frontend web from base".indexOf("from");
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(0, fromCol), schema)).toBeNull();
  });

  it("detects split filter references inside comma-separated tokens", () => {
    const line = "    filter-sequence request comp-req,comp-res";
    const doc = createDocument(`frontend web\n    filter comp-req\n    filter comp-res\n${line}`);
    const secondFilterCol = line.indexOf("comp-res") + 2;
    expect(
      resolveExpectedSymbolReferenceAtCompletion(doc, pos(3, secondFilterCol), schema),
    ).toEqual({ kind: "filter", scopeKey: "frontend:web" });
  });

  it("detects the next split filter segment after a comma", () => {
    const line = "    filter-sequence request comp-req,";
    const doc = createDocument(`frontend web\n    filter comp-req\n${line}`);
    const commaCol = line.length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, commaCol), schema)).toEqual({
      kind: "filter",
      scopeKey: "frontend:web",
    });
  });

  it("detects userlist arguments inside closed sample fetches", () => {
    const line = "    acl AUTH http_auth(stats-auth)";
    const doc = createDocument(`userlist stats-auth\nfrontend web\n${line}`);
    const col = line.indexOf("stats-auth") + 3;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), schema)).toEqual({
      kind: "userlist",
      scopeKey: null,
    });
  });

  it("ignores sample-fetch tokens without configured reference rules", () => {
    const doc = createDocument("frontend web\n    acl X unknown_fetch(users)");
    const col = "    acl X unknown_fetch(users)".indexOf("users");
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(1, col), schema)).toBeNull();
  });

  it("ignores cursor positions outside sample-fetch argument spans", () => {
    const doc = createDocument("frontend web\n    acl AUTH http_auth(stats-auth)");
    const col = "    acl AUTH ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(1, col), schema)).toBeNull();
  });

  it("lists only matching definition names", () => {
    const index = buildSymbolIndex(
      parseDocument(
        createDocument(
          [
            "frontend web",
            "    acl one path /one",
            "    acl two path /two",
            "backend api",
            "    use_backend web",
          ].join("\n"),
        ),
      ),
      schema,
    );
    expect(listDefinitionNames(index, "acl", "frontend:web")).toEqual(["one", "two"]);
    expect(listDefinitionNames(index, "acl", "backend:api")).toEqual([]);
    expect(listDefinitionNames(index, "proxy-section", null)).toEqual(["api", "web"]);
    expect(listDefinitionNames(index, "cache", null)).toEqual([]);
  });

  it("detects non-split reference-pattern targets inside existing tokens", () => {
    const line = "    http-request cache-use my_cache";
    const doc = createDocument(`cache my_cache\nfrontend web\n${line}`);
    const col = line.indexOf("my_cache") + 2;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), schema)).toEqual({
      kind: "cache",
      scopeKey: null,
    });
  });

  it("rejects definition-name positions for sections, ACLs, and filters", () => {
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        createDocument("frontend web"),
        pos(0, "frontend web".indexOf("web")),
        schema,
      ),
    ).toBeNull();
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        createDocument("frontend web\n    acl mine path /mine"),
        pos(1, "    acl mine".indexOf("mine")),
        schema,
      ),
    ).toBeNull();
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        createDocument("frontend web\n    filter mine type compression"),
        pos(1, "    filter mine".indexOf("mine")),
        schema,
      ),
    ).toBeNull();
  });

  it("uses aclReferenceAt when resolveSymbolAtPosition does not match", () => {
    const doc = createDocument(
      "frontend web\n    acl mine path /mine\n    use_backend api if !mine",
    );
    const col = "    use_backend api if !mine".indexOf("mine");
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), schema)).toEqual({
      kind: "acl",
      scopeKey: "frontend:web",
    });
  });

  it("returns null for section headers without inherited defaults references", () => {
    const doc = createDocument("frontend web extra");
    const col = "frontend web extra".indexOf("extra");
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(0, col), schema)).toBeNull();
  });
});

describe("expectedReferenceTesting helpers", () => {
  it("covers split-segment and pattern-prefix helpers", () => {
    expect(expectedReferenceTesting.splitSegmentAtOffset("a,b", ",", 0)).toEqual({
      inSegment: true,
      afterDelimiter: false,
    });
    expect(expectedReferenceTesting.splitSegmentAtOffset("a,b", ",", 2)).toEqual({
      inSegment: false,
      afterDelimiter: true,
    });
    expect(expectedReferenceTesting.splitSegmentAtOffset("a,b", ",", 99)).toEqual({
      inSegment: false,
      afterDelimiter: false,
    });
    expect(
      expectedReferenceTesting.tokensMatchPatternAt([{ text: "cache-use", start: 0, end: 9 }], 0, [
        "cache-use",
      ]),
    ).toBe(true);
    expect(
      expectedReferenceTesting.tokensMatchPatternAt([{ text: "cache-use", start: 0, end: 9 }], 0, [
        "cache-store",
      ]),
    ).toBe(false);
    expect(
      expectedReferenceTesting.referencePatternPrefixMatches(
        [
          { text: "filter-sequence", start: 0, end: 15 },
          { text: "request", start: 16, end: 23 },
        ],
        requireReferencePattern(schema, "filter-sequence"),
        2,
      ),
    ).toBe(true);
    expect(
      expectedReferenceTesting.referencePatternPrefixMatches(
        [{ text: "cache-use", start: 0, end: 9 }],
        requireReferencePattern(schema, "cache-use"),
        0,
      ),
    ).toBe(false);
    expect(expectedReferenceTesting.parseSampleFetchToken("http_auth(users)")).toEqual({
      fetch: "http_auth",
      args: "users",
    });
    expect(expectedReferenceTesting.parseSampleFetchToken("http_auth(")).toEqual({
      fetch: "http_auth",
      args: "",
    });
    expect(expectedReferenceTesting.parseSampleFetchToken("not-a-fetch")).toBeNull();
    expect(
      expectedReferenceTesting.isDefinitionSymbolPosition(
        parseDocument(createDocument("frontend web\n    acl mine path /mine"))[1],
        1,
        schema,
      ),
    ).toBe(true);
    expect(
      expectedReferenceTesting.isDefinitionSymbolPosition(
        parseDocument(createDocument("frontend web from base"))[0],
        2,
        schema,
      ),
    ).toBe(false);

    const mismatchSchema = structuredClone(schema);
    mismatchSchema.statement_rules = [
      {
        keyword: "synthetic",
        kind: "directive",
        match_tokens: ["synthetic", "definition"],
        definition_kind: "cache",
        fixed_slots: [{ role: "name" }],
      },
      {
        keyword: "synthetic",
        kind: "directive",
        match_tokens: ["synthetic", "reference"],
        reference_kind: "cache",
        fixed_slots: [{ role: "name" }],
      },
    ] as never;
    const mismatchLine = parseDocument(
      createDocument("frontend web\n    synthetic other target"),
    )[1];
    expect(
      expectedReferenceTesting.isDefinitionSymbolPosition(mismatchLine, 2, mismatchSchema),
    ).toBe(false);
    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(
        mismatchLine,
        2,
        mismatchLine.tokens[2].start,
        mismatchSchema,
        "frontend:web",
      ),
    ).toBeNull();
  });

  it("covers direct token-index and sample-fetch resolution paths", () => {
    const parsed = parseDocument(
      createDocument(
        [
          "cache shared",
          "frontend web",
          "    filter cache shared",
          "    filter-sequence request comp-a,comp-b",
          "    acl AUTH http_auth_group(users,ignored)",
        ].join("\n"),
      ),
    );
    const scopeKey = "frontend:web";
    const filterCachePattern = requireReferencePattern(schema, "filter", "cache");
    const filterSequencePattern = requireReferencePattern(schema, "filter-sequence");

    expect(
      expectedReferenceTesting.expectedReferencePatternAt(
        parsed[2],
        2,
        parsed[2].tokens[2].end,
        filterCachePattern,
        scopeKey,
      ),
    ).toEqual({ kind: "cache", scopeKey: null });

    expect(
      expectedReferenceTesting.expectedReferencePatternAt(
        parsed[3],
        2,
        parsed[3].tokens[2].start + "comp-a,".length,
        filterSequencePattern,
        scopeKey,
      ),
    ).toEqual({ kind: "filter", scopeKey });

    const authGroupCol = parsed[4].tokens[2].text.indexOf("users") + 2;
    expect(
      expectedReferenceTesting.expectedSampleFetchReferenceAt(
        parsed[4],
        parsed[4].tokens[2].start + authGroupCol,
        fetchReferenceRules(schema),
        scopeKey,
      ),
    ).toEqual({ kind: "userlist", scopeKey: null });

    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(parsed[1], 99, 0, schema, scopeKey),
    ).toBeNull();
  });

  it("covers remaining section-header, pattern, and sample-fetch branches", () => {
    const sectionLine = parseDocument(createDocument("frontend web profile from base"))[0];
    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(
        sectionLine,
        sectionLine.tokens.findIndex((token) => token.text === "profile"),
        sectionLine.tokens.findIndex((token) => token.text === "profile"),
        schema,
        null,
      ),
    ).toBeNull();

    const nestedSectionLine = {
      ...parseDocument(createDocument("frontend web from base"))[0],
      tokens: parseDocument(createDocument("frontend web from base"))[0].tokens.map((token) => ({
        ...token,
        start: token.start + 4,
        end: token.end + 4,
      })),
    };
    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(
        nestedSectionLine,
        3,
        nestedSectionLine.tokens[3].start,
        schema,
        null,
      ),
    ).toBeNull();

    const filterSequencePattern = requireReferencePattern(schema, "filter-sequence");
    const sequenceLine = parseDocument(
      createDocument("frontend web\n    filter-sequence request comp-a,comp-b"),
    )[1];
    const targetToken = sequenceLine.tokens[2];
    expect(
      expectedReferenceTesting.expectedReferencePatternAt(
        sequenceLine,
        2,
        targetToken.start - 1,
        filterSequencePattern,
        "frontend:web",
      ),
    ).toBeNull();

    const customSchema = structuredClone(schema);
    customSchema.symbols = {
      ...customSchema.symbols,
      sample_fetch_references: {
        test_fetch: { reference_kind: "userlist", argument_index: 1, scope: "global" },
      },
    };
    const fetchLine = parseDocument(
      createDocument("frontend web\n    acl X test_fetch(first,second)"),
    )[1];
    const fetchToken = fetchLine.tokens[2];
    const secondArgCol = fetchToken.text.indexOf("second") + 1;
    expect(
      expectedReferenceTesting.expectedSampleFetchReferenceAt(
        fetchLine,
        fetchToken.start + secondArgCol,
        fetchReferenceRules(customSchema),
        "frontend:web",
      ),
    ).toEqual({ kind: "userlist", scopeKey: null });
    expect(
      expectedReferenceTesting.expectedSampleFetchReferenceAt(
        fetchLine,
        fetchToken.start + 1,
        fetchReferenceRules(customSchema),
        "frontend:web",
      ),
    ).toBeNull();
    const firstArgCol = fetchToken.text.indexOf("first") + 1;
    expect(
      expectedReferenceTesting.expectedSampleFetchReferenceAt(
        fetchLine,
        fetchToken.start + firstArgCol,
        fetchReferenceRules(customSchema),
        "frontend:web",
      ),
    ).toBeNull();

    const cacheUsePattern = requireReferencePattern(schema, "cache-use");
    const cacheLine = parseDocument(
      createDocument("frontend web\n    http-request cache-use cache1"),
    )[1];
    const cacheToken = cacheLine.tokens[2];
    expect(
      expectedReferenceTesting.expectedReferencePatternAt(
        cacheLine,
        2,
        cacheToken.start - 1,
        cacheUsePattern,
        "frontend:web",
      ),
    ).toBeNull();
    expect(expectedReferenceTesting.splitSegmentAtOffset("comp-a,", ",", "comp-a,".length)).toEqual(
      {
        inSegment: false,
        afterDelimiter: true,
      },
    );
    expect(expectedReferenceTesting.splitSegmentAtOffset("a", ",", 5)).toEqual({
      inSegment: false,
      afterDelimiter: false,
    });
    expect(
      expectedReferenceTesting.isDefinitionSymbolPosition(
        parseDocument(createDocument("frontend web\n    http-request cache-use cache1"))[1],
        2,
        schema,
      ),
    ).toBe(false);

    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        createDocument("defaults base\nfrontend web from base"),
        pos(1, "frontend web from base".indexOf("from")),
        schema,
      ),
    ).toBeNull();
    expect(
      resolveExpectedSymbolReferenceAtCompletion(
        createDocument("defaults base\nfrontend web from %[var(x)]"),
        pos(1, "frontend web from ".length),
        schema,
      ),
    ).toBeNull();

    const mismatchLine = parseDocument(
      createDocument("frontend web\n    http-request cache-use cache1"),
    )[1];
    expect(
      expectedReferenceTesting.expectedReferencePatternAt(
        mismatchLine,
        1,
        mismatchLine.tokens[2].start,
        requireReferencePattern(schema, "cache-use"),
        "frontend:web",
      ),
    ).toBeNull();

    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(
        parseDocument(createDocument("frontend web\n    balance roundrobin"))[1],
        1,
        parseDocument(createDocument("frontend web\n    balance roundrobin"))[1].tokens[1].start,
        schema,
        "frontend:web",
      ),
    ).toBeNull();

    const fromExprLine = parseDocument(createDocument("frontend web from %[base]"))[0];
    const profileIdx = fromExprLine.tokens.findIndex((token) => token.text === "%[base]");
    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(
        fromExprLine,
        profileIdx,
        fromExprLine.tokens[profileIdx].start,
        schema,
        null,
      ),
    ).toBeNull();

    const dynamicBackendLine = parseDocument(
      createDocument("frontend web\n    use_backend %[var(x)]"),
    )[1];
    expect(
      expectedReferenceTesting.expectedReferenceAtTokenIndex(
        dynamicBackendLine,
        1,
        dynamicBackendLine.tokens[1].start,
        schema,
        "frontend:web",
      ),
    ).toBeNull();
  });
});
