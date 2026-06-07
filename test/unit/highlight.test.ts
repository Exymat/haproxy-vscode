import { readFileSync } from "node:fs";
import { join } from "node:path";

import { analyzeDocument, findTokenOnLine, tokenizeDocument } from "../helpers/highlight";

const fixturesDir = join(__dirname, "..", "fixtures");

const SCOPES = {
  label: "entity.name.type.class.proxy.haproxy",
  acl: "entity.other.attribute-name.acl.haproxy",
  reference: "entity.name.type.proxy.haproxy",
  condition: "keyword.control.conditional.haproxy",
  boolean: "constant.language.boolean.haproxy",
  aclFlag: "storage.modifier.acl.haproxy",
  comparison: "keyword.operator.comparison.haproxy",
  storage: "storage.type",
};

const NAME_SCOPE_EXPECTATIONS = [
  { line: 1, text: "profile_default", scope: SCOPES.label },
  { line: 1, text: "fusion_defaults", scope: SCOPES.reference },
  { line: 2, text: "FRONTEND_PRD", scope: SCOPES.label },
  { line: 2, text: "profile_default", scope: SCOPES.reference },
  { line: 3, text: "acl_sample", scope: SCOPES.acl },
  { line: 4, text: "maintenance_cache", scope: SCOPES.label },
];

describe("highlight", () => {
  it.each([
    { label: "fixture snippet scoped", file: "test-stats-head.cfg" },
    { label: "grammar directives fixture", file: "grammar-directives.cfg" },
  ])("$label is fully scoped", async ({ file }) => {
    const content = readFileSync(join(fixturesDir, file), "utf-8");
    const { lineResults } = await analyzeDocument(content);
    const unscoped = lineResults.flatMap((line) =>
      line.unscoped.map((t) => ({ ...t, lineNo: line.lineNo })),
    );
    expect(unscoped).toEqual([]);
  });

  it("name scope fixture", async () => {
    const content = readFileSync(join(fixturesDir, "name-scopes.cfg"), "utf-8");
    const lineTokens = await tokenizeDocument(content);
    for (const { line, text, scope } of NAME_SCOPE_EXPECTATIONS) {
      const token = findTokenOnLine(lineTokens, line, text);
      expect(token.displayScope).toBe(scope);
    }
  });

  it("scopes ACL flags, conditionals, comparisons, and booleans explicitly", async () => {
    const aclContent = readFileSync(join(fixturesDir, "hapee-acl-snippet.cfg"), "utf-8");
    const aclTokens = await tokenizeDocument(aclContent);

    expect(findTokenOnLine(aclTokens, 2, "if").displayScope).toBe(SCOPES.condition);
    expect(findTokenOnLine(aclTokens, 2, "-m").displayScope).toBe(SCOPES.aclFlag);
    expect(findTokenOnLine(aclTokens, 5, "eq").displayScope).toBe(SCOPES.comparison);

    const directivesContent = readFileSync(join(fixturesDir, "grammar-directives.cfg"), "utf-8");
    const directiveTokens = await tokenizeDocument(directivesContent);
    expect(findTokenOnLine(directiveTokens, 4, "on").displayScope).toBe(SCOPES.boolean);
  });

  it("tokenizes nested sample fetch and converter expressions", async () => {
    const aclContent = readFileSync(join(fixturesDir, "hapee-acl-snippet.cfg"), "utf-8");
    const aclTokens = await tokenizeDocument(aclContent);
    expect(findTokenOnLine(aclTokens, 3, "req.hdr").displayScope).toBe(SCOPES.storage);
    expect(findTokenOnLine(aclTokens, 4, "var").displayScope).toBe(SCOPES.storage);

    const convContent = readFileSync(
      join(fixturesDir, "golden", "test-sample-fetch-conv.cfg"),
      "utf-8",
    );
    const convTokens = await tokenizeDocument(convContent);
    expect(findTokenOnLine(convTokens, 15, "hdr").displayScope).toBe(SCOPES.storage);
    expect(findTokenOnLine(convTokens, 18, "ipmask").displayScope).toBe(SCOPES.storage);
  });
});
