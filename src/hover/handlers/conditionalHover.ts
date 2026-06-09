import * as vscode from "vscode";

import { conditionalBlocksDocsUrl, lookupConditionalDirective } from "../../conditionalDirectives";
import { HaproxyVersion } from "../../version";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

export function tryConditionalHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range } = hc;

  const conditional = lookupConditionalDirective(ctx.token.text);
  if (!conditional || ctx.tokenIndex !== 0) {
    return null;
  }

  const version = data.version as HaproxyVersion;
  return new vscode.Hover(
    hoverMarkdown(
      conditional.name,
      conditional.signature,
      conditional.description,
      [],
      conditionalBlocksDocsUrl(version),
    ),
    range,
  );
}
