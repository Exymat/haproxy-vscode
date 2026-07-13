import { describe, expect, it } from "vitest";

import { DocumentAnalysis } from "../../../src/parser/documentAnalysis";
import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";

const schema = loadSchema("3.4");

describe("DocumentAnalysis", () => {
  it("memoizes line analysis for repeated lookups", () => {
    const document = createDocument("defaults\n    mode http\nfrontend web\n    bind :80");
    const analysis = new DocumentAnalysis(document, schema);
    const line = analysis.parsed[1];
    const first = analysis.getLineAnalysis(line);
    const second = analysis.getLineAnalysis(line);
    expect(first).toBe(second);
    expect(first.statementRule?.keyword).toBe("mode");
  });

  it("tracks allowed keywords per section", () => {
    const document = createDocument("global\n    daemon\nfrontend web\n    bind :80");
    const analysis = new DocumentAnalysis(document, schema);
    const globalLine = analysis.parsed[1];
    const frontendLine = analysis.parsed[3];
    expect(analysis.getLineAnalysis(globalLine).allowed.has("daemon")).toBe(true);
    expect(analysis.getLineAnalysis(frontendLine).allowed.has("bind")).toBe(true);
    expect(analysis.getLineAnalysis(globalLine).allowed.has("bind")).toBe(false);
  });

  it("exposes section outline by start line", () => {
    const document = createDocument("defaults\n    mode http\nfrontend web\n    bind :80");
    const analysis = new DocumentAnalysis(document, schema);
    const outline = analysis.sectionOutlineByStartLine();
    expect(outline.get(0)?.name).toBe("defaults");
    expect(outline.get(2)?.name).toBe("frontend web");
  });
});
