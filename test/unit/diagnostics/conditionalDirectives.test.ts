import { describe, expect, it } from "vitest";

import { computeDiagnostics } from "../../../src/diagnostics";
import {
  conditionalBlocksDocsUrl,
  conditionalBranchInfoForDocument,
  isConditionalBlockDirective,
  isConditionalOrStatusDirective,
  isInactiveConditionalBranch,
  lookupConditionalDirective,
} from "../../../src/diagnostics/conditionalDirectives";
import { buildSymbolIndex, getSymbolIndex } from "../../../src/symbolIndex";
import { ParsedLine } from "../../../src/parser";
import { readValidUpstreamFixture } from "../../helpers/configContracts";
import { createDocument, updateDocument } from "../../helpers/document";
import { parseDocument } from "../../helpers/parse";
import { loadLanguageData, loadSchema, loadSchemaBundle } from "../../helpers/schema";

const schema = loadSchema("3.4");
const languageData = loadLanguageData("3.4");
const bundle = loadSchemaBundle("3.4");

function line(lineNo: number, tokens: string[], section = "frontend"): ParsedLine {
  let col = 0;
  return {
    line: lineNo,
    tokens: tokens.map((text) => {
      const start = col;
      const end = start + text.length;
      col = end + 1;
      return { text, start, end };
    }),
    section,
    isSectionHeader: false,
    anonymousDefaults: false,
  };
}

describe("conditionalDirectives", () => {
  it("recognizes conditional block directives", () => {
    expect(isConditionalOrStatusDirective(schema, ".if")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".elif")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".else")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".endif")).toBe(true);
    expect(isConditionalBlockDirective(".if")).toBe(true);
    expect(isConditionalBlockDirective(".elif")).toBe(true);
    expect(isConditionalBlockDirective(".else")).toBe(true);
    expect(isConditionalBlockDirective(".endif")).toBe(true);
    expect(isConditionalBlockDirective(".notice")).toBe(false);
    expect(isConditionalBlockDirective(undefined)).toBe(false);
  });

  it("recognizes status directives", () => {
    expect(isConditionalOrStatusDirective(schema, ".diag")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, ".warning")).toBe(true);
    expect(isConditionalOrStatusDirective(schema, "bind")).toBe(false);
    expect(isConditionalOrStatusDirective(schema, undefined)).toBe(false);
  });

  it("looks up directive metadata case-insensitively", () => {
    expect(lookupConditionalDirective(languageData, ".IF")?.name).toBe(".if");
    expect(lookupConditionalDirective(languageData, ".notice")?.signature).toBe(
      '.notice "message"',
    );
    expect(lookupConditionalDirective(languageData, "server")).toBeUndefined();
  });

  it("returns undefined when conditional directive metadata is missing", () => {
    expect(
      lookupConditionalDirective({ conditionalDirectives: undefined } as never, ".if"),
    ).toBeUndefined();
  });

  it("builds docs URL for version", () => {
    expect(conditionalBlocksDocsUrl(languageData, "3.4")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#2.4",
    );
  });

  it("tracks nest depth and branch state for known predicates", () => {
    const content = [
      "frontend fe",
      "    .if TRUE",
      "    bind :80",
      "    .else",
      "    bind :8080",
      "    .endif",
    ].join("\n");
    const parsed = parseDocument(createDocument(content));
    const info = conditionalBranchInfoForDocument(parsed);

    expect(info[1].nestDepth).toBe(0);
    expect(info[2].branchState).toBe("active");
    expect(info[4].branchState).toBe("inactive");
    expect(info[5].nestDepth).toBe(1);
  });

  it("treats unknown predicates as active on all branches", () => {
    const content = [
      "frontend fe",
      "    .if !defined(HAPROXY_MWORKER)",
      "    bind :80",
      "    .else",
      "    bind :8080",
      "    .endif",
    ].join("\n");
    const parsed = parseDocument(createDocument(content));
    const info = conditionalBranchInfoForDocument(parsed);

    expect(info[2].branchState).toBe("unknown");
    expect(info[4].branchState).toBe("unknown");
    expect(isInactiveConditionalBranch(info[2].branchState)).toBe(false);
    expect(isInactiveConditionalBranch(info[4].branchState)).toBe(false);
    expect(isInactiveConditionalBranch("active")).toBe(false);
  });

  it("evaluates deterministic negated predicates", () => {
    const content = [
      "frontend fe",
      "    .if !TRUE",
      "    bind :80",
      "    .endif",
      "    .if !FALSE",
      "    bind :8080",
      "    .endif",
    ].join("\n");
    const info = conditionalBranchInfoForDocument(parseDocument(createDocument(content)));

    expect(info[2].branchState).toBe("inactive");
    expect(info[5].branchState).toBe("active");
  });

  it("evaluates streq predicates and orphan elif/else directives", () => {
    const parsed: ParsedLine[] = [
      line(0, ["frontend", "fe"]),
      line(1, [".if", "FALSE"]),
      line(2, ["bind", ":1"]),
      line(3, [".elif", "TRUE"]),
      line(4, ["bind", ":2"]),
      line(5, [".elif", "FALSE"]),
      line(6, ["bind", ":3"]),
      line(7, [".else"]),
      line(8, ["bind", ":4"]),
      line(9, [".endif"]),
      line(10, [".if", "TRUE"]),
      line(11, ["bind", ":5"]),
      line(12, [".elif", 'streq("a", "a")']),
      line(13, ["bind", ":6"]),
      line(14, [".else"]),
      line(15, ["bind", ":7"]),
      line(16, [".endif"]),
      line(17, [".if", 'streq("a", "a")']),
      line(18, ["bind", ":8"]),
      line(19, [".endif"]),
      line(20, [".if", "streq(1, 2)"]),
      line(21, ["bind", ":9"]),
      line(22, [".endif"]),
      line(23, [".if", "streq('x', 'x')"]),
      line(24, ["bind", ":10"]),
      line(25, [".endif"]),
      line(26, [".if", "streq(foo, bar)"]),
      line(27, ["bind", ":11"]),
      line(28, [".endif"]),
      line(29, [".if", "FALSE"]),
      line(30, [".elif", "streq(1, 2)"]),
      line(31, ["bind", ":12"]),
      line(32, [".endif"]),
      line(33, [".if"]),
      line(34, ["bind", ":13"]),
      line(35, [".elif", "TRUE"]),
      line(36, [".else"]),
      line(37, [".endif"]),
      line(38, [".elif", "TRUE"]),
      line(39, [".else"]),
    ];
    const info = conditionalBranchInfoForDocument(parsed);
    expect(info[2].branchState).toBe("inactive");
    expect(info[4].branchState).toBe("active");
    expect(info[6].branchState).toBe("inactive");
    expect(info[8].branchState).toBe("inactive");
    expect(info[11].branchState).toBe("active");
    expect(info[13].branchState).toBe("inactive");
    expect(info[18].branchState).toBe("active");
    expect(info[21].branchState).toBe("inactive");
    expect(info[24].branchState).toBe("active");
    expect(info[27].branchState).toBe("unknown");
    expect(info[31].branchState).toBe("inactive");
    expect(info[34].branchState).toBe("unknown");
  });

  it("evaluates unequal quoted streq constants", () => {
    const parsed = parseDocument(
      createDocument(
        [
          "frontend fe",
          '    .if streq("a", "b")',
          "    bind :80",
          "    .else",
          "    bind :81",
          "    .endif",
        ].join("\n"),
      ),
    );
    const info = conditionalBranchInfoForDocument(parsed);
    expect(info[2].branchState).toBe("inactive");
    expect(info[4].branchState).toBe("active");
  });

  it("skips diagnostics on inactive branch lines", () => {
    const content = [
      "frontend fe",
      "    .if FALSE",
      "    totally-unknown-directive",
      "    .else",
      "    bind :80",
      "    .endif",
    ].join("\n");
    const doc = createDocument(content);
    const diagnostics = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diagnostics.some((diag) => diag.range.start.line === 2)).toBe(false);
    expect(diagnostics.some((diag) => diag.code === "unknown-keyword")).toBe(false);
  });

  it("still reports diagnostics on active branch lines", () => {
    const content = [
      "frontend fe",
      "    .if TRUE",
      "    totally-unknown-directive",
      "    .else",
      "    bind :80",
      "    .endif",
    ].join("\n");
    const doc = createDocument(content);
    const diagnostics = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diagnostics.some((diag) => diag.range.start.line === 2)).toBe(true);
    expect(diagnostics.some((diag) => diag.code === "unknown-keyword")).toBe(true);
  });

  it("skips symbol collection on inactive branch lines", () => {
    const content = [
      "frontend fe",
      "    bind :80",
      "    .if FALSE",
      "    use_backend missing-backend",
      "    .else",
      "    default_backend app",
      "    .endif",
      "backend app",
      "    server s1 127.0.0.1:8080 check",
    ].join("\n");
    const parsed = parseDocument(createDocument(content));
    const index = buildSymbolIndex(parsed, bundle.schema);
    const inactiveRefs = index.references.filter((site) => site.line === 3);
    expect(inactiveRefs.some((site) => site.name === "missing-backend")).toBe(false);
    expect(index.references.some((site) => site.name === "app")).toBe(true);
  });

  it("keeps active context and scope across an inactive section header", () => {
    const content = [
      "frontend fe",
      "    .if FALSE",
      "backend dead",
      "    .endif",
      "    bind :80",
      "    use_backend app",
      "backend app",
      "    server s1 127.0.0.1:8080",
    ].join("\n");
    const doc = createDocument(content);
    const diagnostics = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diagnostics.some((diag) => diag.range.start.line === 4)).toBe(false);
    expect(getSymbolIndex(doc, bundle.schema, 4000)?.scopeKeyByLine[5]).toBe("frontend:fe");
  });

  it("rebuilds symbols when a conditional predicate changes", () => {
    const inactive = ["frontend fe", "    .if FALSE", "    use_backend hidden", "    .endif"].join(
      "\n",
    );
    const doc = createDocument(inactive);
    expect(getSymbolIndex(doc, bundle.schema, 4000)?.references).toHaveLength(0);
    updateDocument(doc, inactive.replace("FALSE", "TRUE"));
    expect(
      getSymbolIndex(doc, bundle.schema, 4000)?.references.some((site) => site.name === "hidden"),
    ).toBe(true);
  });

  it("does not collect symbols when an inactive branch line is patched incrementally", () => {
    const inactive = ["frontend fe", "    .if FALSE", "    use_backend hidden", "    .endif"].join(
      "\n",
    );
    const doc = createDocument(inactive);
    expect(getSymbolIndex(doc, bundle.schema, 4000)?.references).toHaveLength(0);

    updateDocument(doc, inactive.replace("hidden", "still-hidden"));

    const updated = getSymbolIndex(doc, bundle.schema, 4000);
    expect(updated?.references).toHaveLength(0);
    expect(updated?.unresolvedReferences).toHaveLength(0);
  });

  it("valid-upstream conditional-if.cfg has no error diagnostics", () => {
    const content = readValidUpstreamFixture("conditional-if.cfg");
    const doc = createDocument(content, "file:///valid-upstream/conditional-if.cfg");
    const diagnostics = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
      missingReferences: true,
    });
    const errors = diagnostics.filter((diag) => Number(diag.severity) === 0);
    expect(errors).toEqual([]);
  });
});
