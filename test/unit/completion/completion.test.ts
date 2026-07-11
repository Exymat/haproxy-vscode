import { describe, expect, it } from "vitest";

import { provideCompletionItems } from "../../../src/completion";
import { getDocumentContext } from "../../../src/parser/documentContext";
import { provideHover } from "../../../src/hover";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

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
    expect(bind?.detail).toBe("2 forms");
    const documentation = (bind?.documentation as { value?: string } | undefined)?.value ?? "";
    expect(documentation).toContain("bind [<address>]:<port_range> [, ...] [param*]");
    expect(documentation).toContain("bind /<path> [, ...] [param*]");
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

  it("source completion skips packed optional port and suggests sub-options", () => {
    const content = "defaults\n    source 0.0.0.0 ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length, "3.4");
    expect(labels).toEqual(expect.arrayContaining(["interface", "usesrc"]));
    expect(labels).not.toContain("mode");
    expect(labels).not.toContain("balance");
  });

  it("bind completion suggests bind options after repeated addresses", () => {
    const content = "frontend web\n    bind 192.168.1.22:80, :81, 192.168.1.23:82 ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length, "3.4");
    expect(labels).toContain("ssl");
    expect(labels).toContain("interface");
    expect(labels).not.toContain("balance");
  });

  it("bind directive completion uses the peers-specific variant", () => {
    const doc = createDocument("peers cluster\n    bi");
    const bundle = bundles["3.4"];
    const items = provideCompletionItems(
      doc,
      { line: 1, character: "    bi".length } as never,
      bundle.languageData,
      bundle.schema,
    );
    const bind = items.find((item) => item.label === "bind");
    expect(bind).toBeDefined();
    const documentation = (bind?.documentation as { value?: string } | undefined)?.value ?? "";
    expect(documentation).toContain("bind [<address>]:port [param*]");
    expect(documentation).toContain("bind /<path> [param*]");
    expect(documentation).toContain("#11.2-bind");
    expect(documentation).not.toContain("#4.2-bind");
  });

  it("bind directive completion uses the log-forward-specific variant", () => {
    const doc = createDocument("log-forward syslog\n    bi");
    const bundle = bundles["3.4"];
    const items = provideCompletionItems(
      doc,
      { line: 1, character: "    bi".length } as never,
      bundle.languageData,
      bundle.schema,
    );
    const bind = items.find((item) => item.label === "bind");
    expect(bind).toBeDefined();
    const documentation = (bind?.documentation as { value?: string } | undefined)?.value ?? "";
    expect(documentation).toContain("stream log listener");
    expect(documentation).toContain("#12.6-bind");
    expect(documentation).not.toContain("#4.2-bind");
  });

  it("bind completion suggests bind options in log-forward after the address", () => {
    const content = "log-forward syslog\n    bind 127.0.0.1:514 ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length, "3.4");
    expect(labels).toContain("ssl");
    expect(labels).toContain("interface");
    expect(labels).not.toContain("balance");
  });

  it("omits documentation for sparse line-option enum values", () => {
    const content = "backend api\n    server s1 127.0.0.1:80 testcomp ";
    const doc = createDocument(content);
    const bundle = bundles["3.4"];
    const schema = structuredClone(bundle.schema);
    const data = structuredClone(bundle.languageData);
    schema.keywords.testcomp = {
      name: "testcomp",
      sections: ["backend"],
      signatures: ["testcomp <mode>"],
      sources: [],
      contexts: [],
      argument_model: {
        min_args: 1,
        max_args: 1,
        slots: [{ enum: ["noval"], optional: false, value_kind: "enum", variadic: false }],
      },
      arguments: [],
    };
    schema.keyword_groups.server_options = [
      ...(schema.keyword_groups.server_options ?? []),
      "testcomp",
    ];
    data.groups.server_options = [
      ...(data.groups.server_options ?? []),
      {
        name: "testcomp",
        description: "Test completion option.",
        docsUrl: undefined,
        rulesets: [],
        signature: "testcomp <mode>",
      },
    ];

    const items = provideCompletionItems(
      doc,
      { line: 1, character: content.split("\n")[1].length } as never,
      data,
      schema,
    );
    const value = items.find((item) => item.label === "noval");
    expect(value).toBeDefined();
    expect(value?.documentation).toBeUndefined();
  });

  it("returns empty when no completion handler matches", () => {
    const content = "frontend web\n    bind :80 extra";
    const doc = createDocument(content);
    const bundle = bundles["3.2"];
    const line = content.split("\n")[1];
    const items = provideCompletionItems(
      doc,
      { line: 1, character: line.indexOf("extra") + 3 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(items).toEqual([]);
  });
});
