import * as vscode from "vscode";

import { getLineSemanticContext } from "../parser/lineSemanticContext";
import { HaproxyLanguageData } from "../language/languageData";
import { HaproxySchema } from "../schema/types";
import { tryAclRefHover } from "./handlers/aclRefHover";
import { tryActionHover } from "./handlers/actionHover";
import { tryConditionalHover } from "./handlers/conditionalHover";
import { tryDirectiveHover } from "./handlers/directiveHover";
import { tryExpressionHover } from "./handlers/expressionHover";
import { tryLogFormatHover } from "./handlers/logFormatHover";
import { tryLineOptionHover } from "./handlers/lineOptionHover";
import { tryOptionHover } from "./handlers/optionHover";
import { trySymbolHover } from "./handlers/symbolHover";
import { DocumentContextWithToken, HoverContext } from "./types";

export function provideHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  data: HaproxyLanguageData,
  schema: HaproxySchema,
  maxSymbolLines?: number,
): vscode.Hover | null {
  const semantic = getLineSemanticContext(document, position, schema, data);
  const ctx = semantic?.ctx;
  if (!ctx || !ctx.token) {
    return null;
  }

  const hc: HoverContext = {
    document,
    position,
    data,
    schema,
    semantic,
    ctx: ctx as DocumentContextWithToken,
    range: new vscode.Range(ctx.line.line, ctx.token.start, ctx.line.line, ctx.token.end),
    cursorOffset: position.character - ctx.token.start,
    tokenLower: ctx.token.text.toLowerCase(),
    analyzed: semantic.analyzed,
    maxSymbolLines,
  };

  return (
    tryOptionHover(hc) ??
    tryLineOptionHover(hc) ??
    tryConditionalHover(hc) ??
    tryLogFormatHover(hc) ??
    tryExpressionHover(hc) ??
    trySymbolHover(hc) ??
    tryActionHover(hc) ??
    tryAclRefHover(hc) ??
    tryDirectiveHover(hc)
  );
}
