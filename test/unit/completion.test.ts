import { describe, expect, it } from "vitest";

import { provideCompletionItems } from "../../src/completion";
import { getDocumentContext } from "../../src/documentContext";
import { provideHover } from "../../src/hover";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundles = {
  "3.2": loadSchemaBundle("3.2"),
  "3.4": loadSchemaBundle("3.4"),
};
type TestVersion = keyof typeof bundles;

function completionLabels(
  content: string,
  lineNo: number,
  character: number,
  version: TestVersion,
) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const items = provideCompletionItems(
    doc,
    { line: lineNo, character } as never,
    bundle.languageData,
    bundle.schema,
  );
  return items.map((item) => item.label).sort();
}

function hoverText(content: string, lineNo: number, character: number, version: TestVersion) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const hover = provideHover(
    doc,
    { line: lineNo, character } as never,
    bundle.languageData,
    bundle.schema,
  );
  if (!hover) {
    return "";
  }
  const md = Array.isArray(hover.contents) ? hover.contents[0] : hover.contents;
  return typeof md === "string" ? md : ((md as { value?: string })?.value ?? "");
}

function contextKind(content: string, lineNo: number, character: number, version: TestVersion) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const ctx = getDocumentContext(doc, { line: lineNo, character } as never, bundle.schema);
  return ctx?.kind ?? null;
}

describe("completion and hover", () => {
  const lineNo = 1;

  it("mode after space uses directive-argument context", () => {
    const modeAfterSpace = "defaults\n    mode ";
    const cursor = modeAfterSpace.split("\n")[1].length;
    expect(contextKind(modeAfterSpace, lineNo, cursor, "3.4")).toBe("directive-argument");
  });

  it("mode completions on 3.4", () => {
    const modeAfterSpace = "defaults\n    mode ";
    const cursor = modeAfterSpace.split("\n")[1].length;
    const labels = completionLabels(modeAfterSpace, lineNo, cursor, "3.4");
    expect(labels).toEqual(expect.arrayContaining(["tcp", "http", "haterm", "log", "spop"]));
    expect(labels).not.toEqual(expect.arrayContaining(["acl", "bind", "balance"]));
  });

  it("mode prefix h completions", () => {
    const modePrefix = "defaults\n    mode h";
    const cursor = modePrefix.split("\n")[1].length;
    const labels = completionLabels(modePrefix, lineNo, cursor, "3.4");
    expect(labels).toEqual(expect.arrayContaining(["http", "haterm"]));
  });

  it("mode hover on 3.4 mentions haterm", () => {
    const text = hoverText("defaults\n    mode", lineNo, 7, "3.4");
    expect(text).toContain("haterm");
  });

  it("mode hover on 3.2 does not mention haterm", () => {
    const text = hoverText("defaults\n    mode", lineNo, 7, "3.2");
    expect(text).not.toContain("haterm");
  });

  it("bind directive completion uses the section-specific variant", () => {
    const doc = createDocument("frontend web\n    bi");
    const bundle = bundles["3.4"];
    const items = provideCompletionItems(
      doc,
      { line: 1, character: "    bi".length } as never,
      bundle.languageData,
      bundle.schema,
    );
    const bind = items.find((item) => item.label === "bind");
    expect(bind).toBeDefined();
    expect(bind?.detail).toContain("<port_range>");
    expect(bind?.detail).not.toContain(":port [param*]");
  });

  const completionCases = [
    {
      directive: "http-reuse ",
      section: "defaults",
      expected: ["never", "safe", "aggressive", "always"],
      forbidden: ["acl"],
    },
    {
      directive: "hash-preserve-affinity ",
      section: "backend",
      expected: ["always", "maxconn", "maxqueue"],
      forbidden: ["acl"],
    },
    {
      directive: "default-path ",
      section: "global",
      expected: ["current", "config", "parent"],
      forbidden: ["acl"],
    },
    { directive: "chroot ", section: "global", expected: ["auto"], forbidden: ["acl"] },
    {
      directive: "filter-sequence ",
      section: "frontend",
      expected: ["request", "response"],
      forbidden: ["acl"],
    },
    {
      directive: "balance ",
      section: "defaults",
      expected: ["roundrobin", "leastconn"],
      forbidden: ["acl"],
    },
    {
      directive: "compression algo ",
      section: "defaults",
      expected: [],
      forbidden: ["algo", "acl"],
    },
  ] as const;

  it.each(completionCases)(
    "$directive completions",
    ({ directive, section, expected, forbidden }) => {
      const content = `${section}\n    ${directive}`;
      const testLine = 1;
      const cursor = content.split("\n")[1].length;
      const labels = completionLabels(content, testLine, cursor, "3.4");
      for (const name of expected) {
        expect(labels).toContain(name);
      }
      for (const name of forbidden) {
        expect(labels).not.toContain(name);
      }
    },
  );
});
