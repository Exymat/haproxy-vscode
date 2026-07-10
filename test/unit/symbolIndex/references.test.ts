import { parseDocument } from "../../helpers/parse";
import { parseDocumentLines } from "../../../src/parser";
import { collectLineSymbolSites } from "../../../src/symbolIndex/build";
import { collectSampleFetchReferences } from "../../../src/symbolIndex/collectors/sampleFetch";
import {
  buildSymbolIndex,
  findDefinitions,
  findReferences,
  symbolKeyForSchema,
} from "../../../src/symbolIndex";

import { doc, schema } from "./helpers";

describe("symbolIndex references", () => {
  it("uses value token indexes for definitions and unscoped symbol keys", () => {
    const customSchema = structuredClone(schema);
    customSchema.statement_rules = [
      {
        keyword: "use_backend",
        kind: "directive",
        definition_kind: "proxy-section",
        value_token_index: 1,
      },
    ];
    const parsed = parseDocument(doc("frontend web\n    use_backend api"));
    const index = buildSymbolIndex(parsed, customSchema);
    expect(findDefinitions(index, "proxy-section", "api", "frontend:web")).toHaveLength(1);
    expect(symbolKeyForSchema(schema, "proxy-section", "Api", "frontend:web")).toBe(
      "proxy-section:api",
    );
  });

  it("tracks configured global reference patterns from schema", () => {
    const parsed = parseDocument(doc("backend api\n    default-server resolvers dns-main"));
    const index = buildSymbolIndex(parsed, schema);
    const refs = findReferences(index, "resolvers", "dns-main", null);
    expect(refs).toHaveLength(1);
  });

  it("skips empty split references and empty sample-fetch args", () => {
    const customSchema = structuredClone(schema);
    customSchema.reference_patterns = [
      {
        match_tokens: ["set-map"],
        reference_kind: "map",
        target_token_index: 1,
        split: ",",
        scope: "global",
      },
    ] as never;
    const parsed = parseDocument(
      doc("backend api\n    set-map a,,b\n    http-request set-var(txn.x) http_auth()"),
    );
    const sites = collectLineSymbolSites(parsed[1], customSchema, "backend:api");
    expect(
      sites
        .filter((site) => site.kind === ("map" as (typeof site)["kind"]))
        .map((site) => site.name),
    ).toEqual(["a", "b"]);
    expect(collectLineSymbolSites(parsed[2], customSchema, "backend:api")).toEqual([]);
  });

  it("tracks sample-fetch references from non-first arguments with precise ranges", () => {
    const customSchema = structuredClone(schema);
    customSchema.symbols = {
      ...customSchema.symbols,
      sample_fetch_references: {
        custom_auth: {
          argument_index: 1,
          reference_kind: "userlist",
          scope: "global",
        },
        triple_auth: {
          argument_index: 2,
          reference_kind: "userlist",
          scope: "global",
        },
      },
    };
    const content = [
      "frontend web",
      "    http-request deny if custom_auth(primary,stats-auth)",
      "    http-request deny if triple_auth(ignored,skipped,third-user)",
    ].join("\n");
    const parsed = parseDocument(doc(content));
    const index = buildSymbolIndex(parsed, customSchema);
    const refs = findReferences(index, "userlist", "stats-auth", null);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.start).toBe(content.split(/\r?\n/)[1].indexOf("stats-auth"));
    expect(refs[0]?.end).toBe(refs[0]?.start + "stats-auth".length);
    const thirdRefs = findReferences(index, "userlist", "third-user", null);
    expect(thirdRefs).toHaveLength(1);
    expect(thirdRefs[0]?.start).toBe(content.split(/\r?\n/)[2].indexOf("third-user"));
  });

  it("tracks sample-fetch references with default metadata", () => {
    const customSchema = structuredClone(schema);
    customSchema.symbols = {
      ...customSchema.symbols,
      sample_fetch_references: {
        simple_auth: {
          reference_kind: "userlist",
        },
        scoped_auth: {
          reference_kind: "userlist",
          scope: "section",
        },
        missing_arg: {
          reference_kind: "userlist",
          argument_index: 1,
        },
      },
    };
    const parsed = parseDocument(
      doc(
        [
          "frontend web",
          "    http-request deny if simple_auth(global-users)",
          "    http-request deny if scoped_auth(section-users)",
          "    http-request deny if missing_arg(only-one)",
        ].join("\n"),
      ),
    );

    const globalRefs = collectLineSymbolSites(parsed[1], customSchema, "frontend:web").filter(
      (site) => site.kind === "userlist",
    );
    expect(globalRefs).toEqual([
      expect.objectContaining({
        name: "global-users",
        scopeKey: null,
      }),
    ]);

    const scopedRefs = collectLineSymbolSites(parsed[2], customSchema, "frontend:web").filter(
      (site) => site.kind === "userlist",
    );
    expect(scopedRefs).toEqual([
      expect.objectContaining({
        name: "section-users",
        scopeKey: "frontend:web",
      }),
    ]);

    expect(collectLineSymbolSites(parsed[3], customSchema, "frontend:web")).toEqual([]);
  });

  it("collects sample-fetch references from configured argument indexes", () => {
    const sampleLine = parseDocumentLines(["    set-var txn.x var(other,FOO)"])[0];
    const sampleRefs: import("../../../src/symbolIndex/types").SymbolSite[] = [];
    collectSampleFetchReferences(sampleLine, null, sampleRefs, {
      var: {
        reference_kind: "environment-variable",
        argument_index: 1,
        scope: "global",
      },
    });
    expect(sampleRefs.some((ref) => ref.name === "FOO")).toBe(true);
  });

  it("skips sample-fetch references when the configured argument is missing", () => {
    const sparseArgsLine = parseDocumentLines(["    var(a)"])[0];
    const sparseRefs: import("../../../src/symbolIndex/types").SymbolSite[] = [];
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
