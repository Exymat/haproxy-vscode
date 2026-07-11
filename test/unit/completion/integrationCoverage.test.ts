import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { provideCompletionItems } from "../../../src/completion";
import { provideHover } from "../../../src/hover";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const fixturesDir = join(__dirname, "..", "..", "integration", "fixtures");
const bundles = {
  "3.2": loadSchemaBundle("3.2"),
  "3.4": loadSchemaBundle("3.4"),
};

function labels(content: string, line: number, character: number, version: keyof typeof bundles) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  return provideCompletionItems(
    doc,
    { line, character } as never,
    bundle.languageData,
    bundle.schema,
  ).map((item) => (typeof item.label === "string" ? item.label : item.label.label));
}

function hoverText(
  content: string,
  line: number,
  character: number,
  version: keyof typeof bundles,
) {
  const doc = createDocument(content);
  const bundle = bundles[version];
  const hover = provideHover(doc, { line, character } as never, bundle.languageData, bundle.schema);
  const contents = Array.isArray(hover?.contents)
    ? hover.contents
    : hover?.contents
      ? [hover.contents]
      : [];
  return contents
    .map((entry) => (typeof entry === "string" ? entry : "value" in entry ? entry.value : ""))
    .join("");
}

describe("integration-promoted completion and hover coverage", () => {
  it("keeps version-specific mode completion and hover behavior in unit coverage", () => {
    const content = "defaults\n    mode h\n";
    const cursor = "    mode h".length;

    expect(labels(content, 1, cursor, "3.2")).toContain("http");
    expect(labels(content, 1, cursor, "3.2")).not.toContain("haterm");
    expect(hoverText(content, 1, 7, "3.2")).not.toContain("haterm");

    expect(labels(content, 1, cursor, "3.4")).toEqual(expect.arrayContaining(["haterm", "http"]));
    expect(hoverText(content, 1, 7, "3.4")).toContain("haterm");
  });

  it("covers integration-level section and symbol-reference completions", () => {
    expect(labels("", 0, 0, "3.2")).toEqual(
      expect.arrayContaining(["global", "defaults", "frontend", "backend"]),
    );
    expect(
      labels("backend api\nfrontend web\n    use_backend ", 2, "    use_backend ".length, "3.2"),
    ).toContain("api");
    expect(
      labels("defaults base\nfrontend web from ", 1, "frontend web from ".length, "3.2"),
    ).toContain("base");
    expect(
      labels(
        "frontend web\n    acl is_api path_beg /api\n    use_backend api if ",
        2,
        "    use_backend api if ".length,
        "3.2",
      ),
    ).toEqual(expect.arrayContaining(["is_api", "TRUE"]));
  });

  it("covers line-option and action-family completions without Electron", () => {
    expect(
      labels("frontend web\n    bind 127.0.0.1:80 ", 1, "    bind 127.0.0.1:80 ".length, "3.2"),
    ).toEqual(expect.arrayContaining(["ssl", "interface"]));
    expect(
      labels(
        "backend api\n    server s1 127.0.0.1:80 cookie app01 ins",
        1,
        "    server s1 127.0.0.1:80 cookie app01 ins".length,
        "3.2",
      ),
    ).toContain("insert");
    expect(
      labels("frontend web\n    http-response set", 1, "    http-response ".length, "3.2"),
    ).toContain("set-header");
    expect(
      labels(
        "frontend web\n    tcp-request connection ",
        1,
        "    tcp-request connection ".length,
        "3.2",
      ),
    ).not.toContain("acl");
  });

  it("covers file-backed basic-check hover and completion paths", () => {
    const content = readFileSync(join(fixturesDir, "valid-basic-check.cfg"), "utf-8");
    const statsLine = content.split(/\r?\n/).findIndex((line) => line.includes("stats socket"));
    expect(
      hoverText(content, statsLine, content.split(/\r?\n/)[statsLine].indexOf("stats"), "3.2"),
    ).toContain("stats");

    const optionLine = content.split(/\r?\n/).findIndex((line, index, lines) => {
      return line.trim() === "" && lines[index + 1]?.trim().startsWith("server");
    });
    expect(
      labels(content, optionLine, "\t".length, "3.2").some((label) =>
        label.startsWith("tcp-check"),
      ),
    ).toBe(true);
  });
});
