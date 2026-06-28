import { afterEach, describe, expect, it, vi } from "vitest";

import * as directiveUtils from "../../../src/directiveUtils";
import * as languageDataIndexes from "../../../src/languageDataIndexes";
import { tryActionHover } from "../../../src/hover/handlers/actionHover";
import { tryExpressionHover } from "../../../src/hover/handlers/expressionHover";
import { tryLogFormatHover } from "../../../src/hover/handlers/logFormatHover";
import { tryOptionHover } from "../../../src/hover/handlers/optionHover";
import {
  actionHoverContext,
  bundles,
  hoverText,
  logFormatHoverContext,
  optionHoverContext,
} from "./helpers";

describe("hover handlers", () => {
  describe("option and action hover handlers", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("tryOptionHover rejects invalid contexts", () => {
      expect(
        tryOptionHover(
          optionHoverContext("httplog", {
            kind: "directive",
          }),
        ),
      ).toBeNull();
      expect(
        tryOptionHover(
          optionHoverContext("httplog", {
            tokenIndex: 0,
            token: { text: "option", start: 4, end: 10 },
          }),
        ),
      ).toBeNull();
    });

    it("tryOptionHover returns null when neither group nor keyword docs exist", () => {
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue(undefined);
      expect(tryOptionHover(optionHoverContext("notreal"))).toBeNull();
    });

    it("tryOptionHover uses language keyword metadata", () => {
      const hover = tryOptionHover(optionHoverContext("httplog"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("option httplog");
      expect(text).toContain("option httplog [ clf ]");
      expect(text).toContain("Enable logging of HTTP request");
      expect(text).toContain("Valid in sections:");
      expect(text).toContain("Valid in modes:");
      expect(text).toContain("[HAProxy documentation](");
    });

    it("tryOptionHover resolves no-option keywords", () => {
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockImplementation((_data, keyword) => {
        if (keyword === "no option httplog") {
          return bundles["3.4"].languageData.keywords["option httplog"];
        }
        return undefined;
      });

      const hover = tryOptionHover(optionHoverContext("httplog"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(hover)).toContain("Enable logging of HTTP request");
    });

    it("tryOptionHover uses group metadata when language lookup misses", () => {
      const data = structuredClone(bundles["3.4"].languageData);
      data.groups.options = [
        {
          name: "groupopt",
          description: "Group-only option docs.",
          docsUrl: "https://example.test/groupopt",
          rulesets: [],
          signature: "option groupopt",
        },
      ];
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue(undefined);

      const hover = tryOptionHover({
        ...optionHoverContext("groupopt"),
        data,
      });
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("option groupopt");
      expect(text).toContain("Group-only option docs.");
      expect(text).toContain("https://example.test/groupopt");
    });

    it("tryOptionHover leaves description empty when no docs exist", () => {
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue({
        name: "option emptydesc",
        sections: [],
        signatures: ["option emptydesc"],
        arguments: [],
      } as never);

      const hover = tryOptionHover(optionHoverContext("emptydesc"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(hover)).toBe("**option emptydesc**\n\n`option emptydesc`");
    });

    it("tryOptionHover falls back to schema option contexts and token text", () => {
      const bundle = bundles["3.4"];
      const schema = structuredClone(bundle.schema);
      schema.keyword_group_contexts = {
        ...schema.keyword_group_contexts,
        options: {
          ...schema.keyword_group_contexts?.options,
          customopt: ["tcp", "http"],
        },
      };
      vi.spyOn(directiveUtils, "getKeywordFromLanguage").mockReturnValue({
        name: "option customopt",
        description: "Custom option.",
        sections: ["defaults"],
        signatures: [],
        arguments: [],
      } as never);
      vi.spyOn(directiveUtils, "getKeywordFromSchema").mockReturnValue(undefined);

      const hover = tryOptionHover({
        ...optionHoverContext("customopt"),
        schema,
      });
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("option customopt");
      expect(text).toContain("Custom option.");
      expect(text).toContain("**Valid in modes:** tcp, http");
    });

    it("tryActionHover documents actions with and without rulesets", () => {
      const denyHover = tryActionHover(actionHoverContext("deny"));
      expect(denyHover).not.toBeNull();
      if (denyHover === null) {
        throw new Error("expected hover");
      }
      const denyText = hoverText(denyHover);
      expect(denyText.toLowerCase()).toContain("deny");
      expect(denyText).toContain("immediately rejects");
      expect(denyText).toContain("**Rulesets:** http-request, http-response");

      const closeHover = tryActionHover(actionHoverContext("close"));
      expect(closeHover).not.toBeNull();
      if (closeHover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(closeHover)).not.toContain("**Rulesets:**");
    });

    it("tryActionHover scans later action groups and rejects unknown actions", () => {
      const attachHover = tryActionHover(actionHoverContext("attach-srv"));
      expect(attachHover).not.toBeNull();
      if (attachHover === null) {
        throw new Error("expected hover");
      }
      expect(hoverText(attachHover)).toContain("attach-srv");

      expect(tryActionHover(actionHoverContext("not-a-real-action"))).toBeNull();
    });

    it("tryActionHover resolves parenthesized action names", () => {
      const hover = tryActionHover(actionHoverContext("set-var-fmt(txn.bench_log)"));
      expect(hover).not.toBeNull();
      if (hover === null) {
        throw new Error("expected hover");
      }
      const text = hoverText(hover);
      expect(text).toContain("set-var-fmt");
      expect(text).toContain("variable");
      expect(text).not.toContain("Access control for Layer 7 requests");
    });

    it("tryExpressionHover rejects non-expression contexts", () => {
      expect(tryExpressionHover(optionHoverContext("httplog"))).toBeNull();
    });

    it("tryLogFormatHover documents aliases, flags, and rejects unknown items", () => {
      const aliasLine = '    log-format "%{+Q}o %ci"';
      const aliasHover = tryLogFormatHover(
        logFormatHoverContext(aliasLine, aliasLine.indexOf("ci") + 1),
      );
      expect(aliasHover).not.toBeNull();
      if (aliasHover === null) {
        throw new Error("expected alias hover");
      }
      expect(hoverText(aliasHover)).toContain("%ci");

      const flagLine = '    log-format "%{+Q}"';
      const flagHover = tryLogFormatHover(logFormatHoverContext(flagLine, flagLine.indexOf("Q")));
      expect(flagHover).not.toBeNull();
      if (flagHover === null) {
        throw new Error("expected flag hover");
      }
      expect(hoverText(flagHover)).toContain("Q");

      const unknownLine = '    log-format "%zz"';
      expect(
        tryLogFormatHover(logFormatHoverContext(unknownLine, unknownLine.indexOf("zz"))),
      ).toBeNull();

      const outsideLine = "    mode http";
      expect(tryLogFormatHover(logFormatHoverContext(outsideLine, 8))).toBeNull();

      const gapLine = '    log-format "%o  ci"';
      expect(
        tryLogFormatHover(logFormatHoverContext(gapLine, gapLine.indexOf("  ") + 1)),
      ).toBeNull();

      const plusLine = '    log-format "%{+Q}"';
      expect(tryLogFormatHover(logFormatHoverContext(plusLine, plusLine.indexOf("+")))).toBeNull();

      const exprLine = '    log-format "%[src]"';
      expect(
        tryLogFormatHover(logFormatHoverContext(exprLine, exprLine.indexOf("src"))),
      ).toBeNull();

      const quoteLine = '    log-format "%ci"';
      expect(
        tryLogFormatHover(logFormatHoverContext(quoteLine, quoteLine.indexOf('"'))),
      ).toBeNull();

      const minusFlagLine = '    log-format "%{-E}"';
      const minusFlagHover = tryLogFormatHover(
        logFormatHoverContext(minusFlagLine, minusFlagLine.indexOf("E")),
      );
      expect(minusFlagHover).not.toBeNull();

      const origFindIndexedGroupItem = languageDataIndexes.findIndexedGroupItem;
      vi.spyOn(languageDataIndexes, "findIndexedGroupItem").mockImplementation(
        (data, group, name) => {
          if (group === "logformat_flags") {
            return undefined;
          }
          return origFindIndexedGroupItem(data, group, name);
        },
      );
      const noDocFlagLine = '    log-format "%{+Q}"';
      expect(
        tryLogFormatHover(logFormatHoverContext(noDocFlagLine, noDocFlagLine.indexOf("Q"))),
      ).toBeNull();
    });
  });
});
