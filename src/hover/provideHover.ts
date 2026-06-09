import * as vscode from "vscode";

import { getDocumentContext } from "../documentContext";
import { HaproxyLanguageData } from "../languageData";
import { HaproxySchema } from "../schema";
import { tryAclRefHover } from "./handlers/aclRefHover";
import { tryActionHover } from "./handlers/actionHover";
import { tryConditionalHover } from "./handlers/conditionalHover";
import { tryDirectiveHover } from "./handlers/directiveHover";
import { tryExpressionHover } from "./handlers/expressionHover";
import { tryLineOptionHover } from "./handlers/lineOptionHover";
import { tryOptionHover } from "./handlers/optionHover";
import { DocumentContextWithToken, HoverContext } from "./types";

export function provideHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  data: HaproxyLanguageData,
  schema: HaproxySchema,
): vscode.Hover | null {
  const ctx = getDocumentContext(document, position, schema);
  if (!ctx || !ctx.token) {
    return null;
  }

  const hc: HoverContext = {
    document,
    position,
    data,
    schema,
    ctx: ctx as DocumentContextWithToken,
    range: new vscode.Range(ctx.line.line, ctx.token.start, ctx.line.line, ctx.token.end),
    cursorOffset: position.character - ctx.token.start,
    tokenLower: ctx.token.text.toLowerCase(),
  };

  return (
    tryOptionHover(hc) ??
    tryLineOptionHover(hc) ??
    tryActionHover(hc) ??
    tryConditionalHover(hc) ??
    tryExpressionHover(hc) ??
    tryAclRefHover(hc) ??
    tryDirectiveHover(hc)
  );
}
