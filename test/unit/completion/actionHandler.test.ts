import { describe, expect, it } from "vitest";

import { tryActionCompletion } from "../../../src/completion/handlers/action";
import { CompletionContext } from "../../../src/completion/types";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function actionContext(kind: string, partial = ""): CompletionContext {
  const text = `    ${kind} ${partial}`;
  const keyword = kind;
  const tokenStart = 4 + keyword.length + 1;
  return {
    document: createDocument(`frontend web\n${text}`),
    position: { line: 1, character: text.length } as never,
    data: bundle.languageData,
    schema: bundle.schema,
    ctx: {
      kind,
      tokenIndex: 1,
      line: {
        line: 1,
        text,
        indent: 4,
        section: "frontend",
        tokens: [
          { text: keyword, start: 4, end: 4 + keyword.length },
          { text: partial, start: tokenStart, end: tokenStart + partial.length },
        ],
      },
    } as never,
    partial,
  };
}

describe("tryActionCompletion", () => {
  it("returns null for non-action contexts", () => {
    const cc = actionContext("http-request", "set");
    cc.ctx = { ...cc.ctx, kind: "directive" };
    expect(tryActionCompletion(cc)).toBeNull();
  });

  it("returns http-request actions", () => {
    const items = tryActionCompletion(actionContext("http-request", "set"));
    expect(items).not.toBeNull();
    expect(items?.map((item) => item.label)).toContain("set-header");
  });

  it("returns tcp-request actions", () => {
    const items = tryActionCompletion(actionContext("tcp-request", "ac"));
    expect(items).not.toBeNull();
    expect(
      items?.some((item) => typeof item.label === "string" && item.label.includes("accept")),
    ).toBe(true);
  });
});
