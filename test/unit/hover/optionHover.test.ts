import { describe, expect, it } from "vitest";

import { tryOptionHover } from "../../../src/hover/handlers/optionHover";
import { hoverText, optionHoverContext } from "./helpers";

describe("tryOptionHover", () => {
  it("returns null outside option contexts", () => {
    const hc = optionHoverContext("httplog");
    hc.ctx = { ...hc.ctx, kind: "directive" };
    expect(tryOptionHover(hc)).toBeNull();
  });

  it("returns hover markdown for known options", () => {
    const hover = tryOptionHover(optionHoverContext("httplog"));
    expect(hover).not.toBeNull();
    if (!hover) {
      throw new Error("expected option hover");
    }
    expect(hoverText(hover)).toContain("option httplog");
  });

  it("returns hover for no-option keywords", () => {
    const hc = optionHoverContext("redispatch", {
      line: {
        line: 1,
        section: "defaults",
        tokens: [
          { text: "no", start: 4, end: 6 },
          { text: "option", start: 7, end: 13 },
          { text: "redispatch", start: 14, end: 24 },
        ],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      tokenIndex: 2,
      token: { text: "redispatch", start: 14, end: 24 },
      kind: "option",
      prefix: "    no option redispatch",
      lineText: "    no option redispatch",
    });
    const hover = tryOptionHover(hc);
    expect(hover).not.toBeNull();
    if (!hover) {
      throw new Error("expected no-option hover");
    }
    expect(hoverText(hover)).toContain("option redispatch");
  });
});
