import * as vscode from "vscode";

import { logFormatContextAt } from "../../logFormat";
import { logFormatDirectiveKeywordSet } from "../../schema";
import { CompletionContext } from "../types";
import { logFormatCompletionItems } from "../helpers";

export function tryLogFormatCompletion(cc: CompletionContext): vscode.CompletionItem[] | null {
  const firstToken = cc.ctx.line.tokens[0]?.text.toLowerCase();
  if (!firstToken || !logFormatDirectiveKeywordSet(cc.schema).has(firstToken)) {
    return null;
  }

  const lineText = cc.document.lineAt(cc.position.line).text;
  const fmtContext = logFormatContextAt(
    lineText,
    cc.ctx.line.tokens,
    cc.position.character,
    cc.schema,
  );
  if (!fmtContext) {
    return null;
  }
  return logFormatCompletionItems(
    cc.data,
    cc.schema,
    fmtContext.region.text,
    fmtContext.localOffset,
  );
}
