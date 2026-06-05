import { parseDocument } from "../../src/parser";
import { buildSectionSymbols } from "../../src/sectionOutline";
import { createDocument } from "../helpers/document";

function runCase(
  name: string,
  content: string,
  expected: Array<{ name: string; startLine: number; endLine: number }>,
) {
  const doc = createDocument(content);
  const parsed = parseDocument(doc as never);
  const symbols = buildSectionSymbols(parsed, doc.lineCount);
  const actual = symbols.map((symbol) => ({
    name: symbol.name,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  }));
  expect(actual, name).toEqual(expected);
}

describe("document symbols", () => {
  it("basic sections", () => {
    runCase("basic sections", "global\n    daemon\n\ndefaults\n    mode http\n", [
      { name: "global", startLine: 0, endLine: 2 },
      { name: "defaults", startLine: 3, endLine: 5 },
    ]);
  });

  it("named proxy sections", () => {
    runCase(
      "named proxy sections",
      "frontend web\n    bind :80\nbackend api\n    server s1 127.0.0.1:8080",
      [
        { name: "frontend web", startLine: 0, endLine: 1 },
        { name: "backend api", startLine: 2, endLine: 3 },
      ],
    );
  });

  it("last section runs to EOF", () => {
    runCase("last section runs to EOF", "listen stats\n    bind :8888\n    stats uri /", [
      { name: "listen stats", startLine: 0, endLine: 2 },
    ]);
  });

  it("ignores indented false positives", () => {
    runCase("ignores indented false positives", "frontend web\n    backend foo", [
      { name: "frontend web", startLine: 0, endLine: 1 },
    ]);
  });
});
