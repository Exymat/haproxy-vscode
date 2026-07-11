import { afterEach, describe, expect, it, vi } from "vitest";

import * as documentContext from "../../../src/parser/documentContext";
import * as directiveUtils from "../../../src/language/directiveUtils";
import * as languageData from "../../../src/language/languageData";
import { provideHover } from "../../../src/hover";
import { createDocument } from "../../helpers/document";
import { bundles, hoverMarkdown, hoverText } from "./helpers";

describe("provideHover fallbacks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers version-specific, prefix-matching, and fallback documentation", () => {
    expect(hoverMarkdown("defaults\n    mode", 1, 7, "3.4")).toContain("haterm");
    expect(hoverMarkdown("defaults\n    mode", 1, 7, "3.2")).not.toContain("haterm");
    expect(
      hoverMarkdown(
        "defaults\n    balance url_param sid",
        1,
        "    balance url_param sid".indexOf("url_param"),
        "3.4",
      ).toLowerCase(),
    ).toContain("url_param");
    expect(
      hoverMarkdown(
        "defaults\n    balance roundrobin",
        1,
        "    balance roundrobin".indexOf("roundrobin"),
        "3.4",
      ).toLowerCase(),
    ).toContain("roundrobin");
    expect(hoverMarkdown("defaults\n    totallyunknownkeyword", 1, 8, "3.4")).toBe("");
  });

  it("returns null when document context is unavailable", () => {
    expect(hoverMarkdown("frontend web", 0, "frontend web".indexOf("web"), "3.4")).toBe("");
  });

  it("covers group-item fallback paths and unknown-token null paths", () => {
    const doc = createDocument("frontend web\n    acl test base /");
    const bundle = bundles["3.4"];
    const baseCol = "    acl test base".indexOf("base");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [
          { text: "acl", start: 4, end: 7 },
          { text: "test", start: 8, end: 12 },
          { text: "base", start: baseCol, end: baseCol + 4 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    acl test base /",
      tokenIndex: 2,
      token: { text: "base", start: baseCol, end: baseCol + 4 },
      kind: "directive",
      prefix: "    acl test base",
    });
    vi.spyOn(languageData, "findKeywordByPrefix").mockReturnValue(undefined);
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: false,
      keyword: "",
      start: 0,
      end: 0,
    });
    const baseHover = provideHover(
      doc,
      { line: 1, character: baseCol + 1 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(baseHover).not.toBeNull();
    if (!baseHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(baseHover)).toContain("base");

    const unknownDoc = createDocument("frontend web\n    acl test unknown");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [
          { text: "acl", start: 4, end: 7 },
          { text: "test", start: 8, end: 12 },
          { text: "unknown", start: 13, end: 20 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    acl test unknown",
      tokenIndex: 2,
      token: { text: "unknown", start: 13, end: 20 },
      kind: "acl-criterion",
      prefix: "    acl test unknown",
    });
    expect(
      provideHover(
        unknownDoc,
        { line: 1, character: 15 } as never,
        bundle.languageData,
        bundle.schema,
      ),
    ).toBeNull();
  });

  it("covers argument and directive fallback formatting", () => {
    const doc = createDocument("defaults\n    mode custom");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "defaults",
        tokens: [
          { text: "mode", start: 4, end: 8 },
          { text: "custom", start: 9, end: 15 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    mode custom",
      tokenIndex: 1,
      token: { text: "custom", start: 9, end: 15 },
      kind: "directive-argument",
      prefix: "    mode custom",
    });
    vi.spyOn(directiveUtils, "resolveDirective").mockReturnValue({
      matched: true,
      keyword: "mode",
      start: 0,
      end: 0,
    });
    vi.spyOn(directiveUtils, "findArgumentValue").mockReturnValue({
      name: "custom",
      description: "HTTP mode",
      parameter: "",
    });
    vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue(undefined);
    const customHover = provideHover(
      doc,
      { line: 1, character: "    mode custom".indexOf("custom") + 1 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(customHover).not.toBeNull();
    if (!customHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(customHover)).toContain("HTTP mode");

    const fallbackDoc = createDocument("defaults\n    mode");
    const data = structuredClone(bundle.languageData);
    data.keywords.mode = {
      ...data.keywords.mode,
      signatures: [],
      sections: [],
      description: "",
      arguments: [],
    };
    const fallbackHover = provideHover(
      fallbackDoc,
      { line: 1, character: 7 } as never,
      data,
      bundle.schema,
    );
    expect(fallbackHover).not.toBeNull();
    if (!fallbackHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(fallbackHover)).toContain("mode");
  });

  it("covers no-option and line-option fallback docs", () => {
    const doc = createDocument("defaults\n    no option httplog");
    const bundle = bundles["3.4"];
    const httplogStart = "    no option httplog".indexOf("httplog");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "defaults",
        tokens: [
          { text: "no", start: 4, end: 6 },
          { text: "option", start: 7, end: 13 },
          { text: "httplog", start: httplogStart, end: httplogStart + 7 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    no option httplog",
      tokenIndex: 2,
      token: { text: "httplog", start: httplogStart, end: httplogStart + 7 },
      kind: "option",
      prefix: "    no option httplog",
    });
    const noOptionHover = provideHover(
      doc,
      { line: 1, character: httplogStart + 2 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(noOptionHover).not.toBeNull();
    if (!noOptionHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(noOptionHover)).toContain("option httplog");
  });
});
