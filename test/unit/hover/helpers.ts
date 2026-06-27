import { provideHover } from "../../../src/hover";
import { parseDocument } from "../../../src/parser";
import type { DocumentContextWithToken, HoverContext } from "../../../src/hover/types";
import { MarkdownString, Range } from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

export const bundles = {
  "3.2": loadSchemaBundle("3.2"),
  "3.4": loadSchemaBundle("3.4"),
};

export type TestVersion = keyof typeof bundles;

export function hoverText(hover: NonNullable<ReturnType<typeof provideHover>>): string {
  const md = Array.isArray(hover.contents) ? hover.contents[0] : hover.contents;
  if (md instanceof MarkdownString) {
    return md.value;
  }
  return typeof md === "string" ? md : ((md as { value?: string })?.value ?? "");
}

export function hoverMarkdown(
  content: string,
  lineNo: number,
  character: number,
  version: TestVersion,
) {
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
  return hoverText(hover);
}

export function optionHoverContext(
  tokenText: string,
  overrides: Partial<DocumentContextWithToken> = {},
): HoverContext {
  const start = 11;
  const end = start + tokenText.length;
  const ctx: DocumentContextWithToken = {
    line: {
      line: 1,
      section: "defaults",
      tokens: [
        { text: "option", start: 4, end: 10 },
        { text: tokenText, start, end },
      ],
      isSectionHeader: false,
      anonymousDefaults: false,
    },
    lineText: `    option ${tokenText}`,
    tokenIndex: 1,
    token: { text: tokenText, start, end },
    kind: "option",
    prefix: `    option ${tokenText}`,
    ...overrides,
  };
  return {
    document: createDocument(""),
    position: { line: ctx.line.line, character: ctx.token.start } as never,
    data: bundles["3.4"].languageData,
    schema: bundles["3.4"].schema,
    ctx,
    range: new Range(ctx.line.line, ctx.token.start, ctx.line.line, ctx.token.end) as never,
    cursorOffset: 0,
    tokenLower: ctx.token.text.toLowerCase(),
  };
}

export function actionHoverContext(
  tokenLower: string,
  data = bundles["3.4"].languageData,
): HoverContext {
  return {
    document: createDocument(""),
    position: { line: 1, character: 0 } as never,
    data,
    schema: bundles["3.4"].schema,
    ctx: optionHoverContext(tokenLower).ctx,
    range: new Range(1, 0, 1, tokenLower.length) as never,
    cursorOffset: 0,
    tokenLower,
  };
}

export function logFormatHoverContext(lineText: string, character: number): HoverContext {
  const doc = createDocument(`defaults\n${lineText}`);
  const parsed = parseDocument(doc);
  const line = parsed[1];
  const token = line.tokens[line.tokens.length - 1] ?? line.tokens[0];
  return {
    document: doc,
    position: { line: 1, character } as never,
    data: bundles["3.4"].languageData,
    schema: bundles["3.4"].schema,
    ctx: {
      line,
      lineText,
      tokenIndex: line.tokens.length - 1,
      token,
      kind: "directive-argument",
      prefix: lineText.slice(0, character),
    },
    range: new Range(1, token.start, 1, token.end) as never,
    cursorOffset: character - token.start,
    tokenLower: token.text.toLowerCase(),
  };
}
