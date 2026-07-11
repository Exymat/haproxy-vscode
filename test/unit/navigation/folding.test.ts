import { parseDocument } from "../../helpers/parse";
import {
  buildSectionFoldRanges,
  buildSectionSymbols,
} from "../../../src/navigation/sectionOutline";
import { createDocument } from "../../helpers/document";

function runCase(
  name: string,
  content: string,
  expected: Array<{ startLine: number; endLine: number }>,
) {
  const doc = createDocument(content);
  const parsed = parseDocument({
    lineCount: doc.lineCount,
    lineAt(lineNo: number) {
      return { text: content.split(/\r?\n/)[lineNo] ?? "" };
    },
  } as never);
  const sections = buildSectionSymbols(parsed, doc.lineCount);
  const actual = buildSectionFoldRanges(sections);
  expect(actual).toEqual(expected);
}

describe("folding", () => {
  it("folds section body below header", () => {
    runCase("folds section body below header", "global\n    daemon\n    maxconn 100", [
      { startLine: 0, endLine: 2 },
    ]);
  });

  it("multiple sections", () => {
    runCase("multiple sections", "global\n    daemon\n\ndefaults\n    mode http", [
      { startLine: 0, endLine: 2 },
      { startLine: 3, endLine: 4 },
    ]);
  });

  it("skips header-only section", () => {
    runCase("skips header-only section", "global\nfrontend web\n    bind :80", [
      { startLine: 1, endLine: 2 },
    ]);
  });

  it("ignores indented backend keyword", () => {
    runCase("ignores indented backend keyword", "frontend web\n    backend foo\n    bind :80", [
      { startLine: 0, endLine: 2 },
    ]);
  });

  it("includes trailing blank lines before next section", () => {
    runCase(
      "includes trailing blank lines before next section",
      "global\n    maxconn 100\n\n\n\ndefaults\n    mode http",
      [
        { startLine: 0, endLine: 4 },
        { startLine: 5, endLine: 6 },
      ],
    );
  });

  it("keeps blank lines within a section body", () => {
    runCase(
      "keeps blank lines within a section body",
      "frontend web\n    bind :80\n\n    default_backend www",
      [{ startLine: 0, endLine: 3 }],
    );
  });
});
