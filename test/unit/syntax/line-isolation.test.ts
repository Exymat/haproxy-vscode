import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findLineIsolationViolations, loadGrammarObject } from "../../helpers/highlight";

const fixturesDir = join(__dirname, "..", "..", "fixtures");
const benchFixture = join(__dirname, "..", "..", "bench", "fixtures", "large-mixed.cfg");

interface BeginEndRule {
  path: string;
  begin: string;
  end: string;
  name?: string;
}

function collectBeginEndRules(node: unknown, path: string, rules: BeginEndRule[]): void {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      collectBeginEndRules(node[index], `${path}[${index}]`, rules);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.begin === "string" && typeof record.end === "string") {
    rules.push({
      path,
      begin: record.begin,
      end: record.end,
      name: typeof record.name === "string" ? record.name : undefined,
    });
  }
  for (const [key, value] of Object.entries(record)) {
    collectBeginEndRules(value, path ? `${path}.${key}` : key, rules);
  }
}

function assertGrammarLineIsolated(grammar: ReturnType<typeof loadGrammarObject>): void {
  const rules: BeginEndRule[] = [];
  collectBeginEndRules(grammar, "", rules);
  const violations = rules.filter((rule) => !rule.end.includes("$"));
  expect(violations).toEqual([]);
}

const MALFORMED_SNIPPETS = [
  {
    label: "unclosed double quote",
    content: 'frontend x\n    description "hello\nfrontend y\n',
  },
  {
    label: "unclosed sample expression",
    content: "frontend x\n    http-request set-header x-bad %[req.hdr(host)\nfrontend y\n",
  },
  {
    label: "unclosed acl brace",
    content: "frontend x\n    use_backend y if { path_beg /api\nfrontend z\n",
  },
  {
    label: "unclosed sample call string",
    content: 'frontend x\n    http-request set-var(txn.x) str("open\nfrontend y\n',
  },
] as const;

describe("line isolation", () => {
  it("active grammar begin/end rules terminate at end-of-line", () => {
    assertGrammarLineIsolated(loadGrammarObject());
  });

  it.each(MALFORMED_SNIPPETS)(
    "malformed snippet stays line-isolated ($label)",
    async ({ content }) => {
      expect(await findLineIsolationViolations(content)).toEqual([]);
    },
  );

  it.each(
    readdirSync(fixturesDir)
      .filter((name) => name.endsWith(".cfg"))
      .map((file) => ({ file })),
  )("fixture $file has no cross-line rule stack", async ({ file }) => {
    const content = readFileSync(join(fixturesDir, file), "utf-8");
    expect(await findLineIsolationViolations(content)).toEqual([]);
  });

  it("large mixed bench fixture has no cross-line rule stack", async () => {
    const content = readFileSync(benchFixture, "utf-8");
    expect(await findLineIsolationViolations(content)).toEqual([]);
  }, 30_000);
});
