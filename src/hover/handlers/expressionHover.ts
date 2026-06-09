import * as vscode from "vscode";

import { findGroupItem, findGroupItemIn, sampleTokenCandidates } from "../helpers";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

export function tryExpressionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range, cursorOffset } = hc;

  if (ctx.kind === "acl-criterion" && ctx.tokenIndex >= 2) {
    for (const candidate of sampleTokenCandidates(ctx.token.text, cursorOffset)) {
      const group =
        findGroupItemIn(data, "sample_fetches", candidate) ??
        findGroupItemIn(data, "acl_criteria", candidate) ??
        findGroupItem(data, candidate);
      if (group) {
        return new vscode.Hover(
          hoverMarkdown(group.name, group.signature, group.description, [], group.docsUrl),
          range,
        );
      }
    }
  }

  if (ctx.kind === "expression-fetch" || ctx.kind === "expression-converter") {
    for (const candidate of sampleTokenCandidates(ctx.token.text, cursorOffset)) {
      const group =
        (ctx.kind === "expression-fetch"
          ? findGroupItemIn(data, "sample_fetches", candidate)
          : findGroupItemIn(data, "sample_converters", candidate)) ??
        findGroupItem(data, candidate);
      if (group) {
        return new vscode.Hover(
          hoverMarkdown(group.name, group.signature, group.description, [], group.docsUrl),
          range,
        );
      }
    }
  }

  return null;
}
