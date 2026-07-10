import { provideHover } from "../../../src/hover";
import { parseDocument } from "../../helpers/parse";
import type { DocumentContextWithToken, HoverContext } from "../../../src/hover/types";
import {
  getKeywordFromLanguage,
  getKeywordFromSchema,
  resolveDirective,
} from "../../../src/directiveUtils";
import { analyzeLine } from "../../../src/lineAnalysis";
import { indexedKeywordNameSetForSection } from "../../../src/languageDataIndexes";
import { getLineSemanticContext, LineSemanticContext } from "../../../src/lineSemanticContext";
import { HaproxyLanguageData } from "../../../src/languageData";
import { HaproxySchema } from "../../../src/schema/types";
import { sectionKeywordSet } from "../../../src/schema/keywords";
import { modifierPrefixSet, noPrefixKeywordSet } from "../../../src/schema/tokens";
import { MarkdownString, Range } from "../../__mocks__/vscode";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

export const bundles = {
  "3.0": loadSchemaBundle("3.0"),
  "3.2": loadSchemaBundle("3.2"),
  "3.4": loadSchemaBundle("3.4"),
};

export type TestVersion = keyof typeof bundles;

function buildSemanticContext(
  document: ReturnType<typeof createDocument>,
  position: { line: number; character: number },
  schema: HaproxySchema,
  data: HaproxyLanguageData,
  ctx: DocumentContextWithToken,
): LineSemanticContext {
  const allowed = sectionKeywordSet(schema, ctx.line.section);
  const directiveAllowed = ctx.line.section
    ? new Set(indexedKeywordNameSetForSection(data, ctx.line.section))
    : allowed;
  const analyzed = analyzeLine(ctx.line, {
    schema,
    allowed,
    noPrefix: noPrefixKeywordSet(schema),
    modifierPrefixes: modifierPrefixSet(schema),
  });
  const directive = resolveDirective(ctx.line, directiveAllowed, {
    noPrefixKeywords: noPrefixKeywordSet(schema),
    modifierPrefixes: modifierPrefixSet(schema),
  });
  const resolvedLanguageKeyword = directive.matched
    ? getKeywordFromLanguage(data, directive.keyword, ctx.line.section)
    : undefined;
  const resolvedSchemaKeyword = directive.matched
    ? getKeywordFromSchema(schema, directive.keyword, ctx.line.section)
    : undefined;

  return {
    document,
    position: position as never,
    schema,
    data,
    ctx,
    allowed,
    analyzed,
    directive,
    resolvedLanguageKeyword,
    resolvedSchemaKeyword,
  };
}

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
  const document = createDocument("");
  const position = { line: ctx.line.line, character: ctx.token.start } as never;
  const data = bundles["3.4"].languageData;
  const schema = bundles["3.4"].schema;
  return {
    document,
    position,
    data,
    schema,
    semantic: buildSemanticContext(document, position, schema, data, ctx),
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
  const base = optionHoverContext(tokenLower);
  return {
    document: base.document,
    position: { line: 1, character: 0 } as never,
    data,
    schema: bundles["3.4"].schema,
    semantic: buildSemanticContext(
      base.document,
      { line: 1, character: 0 },
      bundles["3.4"].schema,
      data,
      base.ctx,
    ),
    ctx: base.ctx,
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
  const position = { line: 1, character } as never;
  const data = bundles["3.4"].languageData;
  const schema = bundles["3.4"].schema;
  const semantic = getLineSemanticContext(doc, position, schema, data);
  if (!semantic?.ctx.token) {
    throw new Error("logFormatHoverContext requires a token at the cursor");
  }
  const ctx = semantic.ctx as DocumentContextWithToken;
  return {
    document: doc,
    position,
    data,
    schema,
    semantic,
    ctx,
    range: new Range(1, token.start, 1, token.end) as never,
    cursorOffset: character - token.start,
    tokenLower: token.text.toLowerCase(),
  };
}
