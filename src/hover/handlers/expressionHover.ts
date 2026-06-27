import * as vscode from "vscode";

import { findIndexedGroupItem } from "../../languageDataIndexes";
import { findGroupItem, sampleTokenCandidates } from "../helpers";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

export function tryExpressionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range, cursorOffset } = hc;

  if (ctx.kind === "acl-criterion" && ctx.tokenIndex >= 2) {
    if (ctx.token.text.startsWith("-")) {
      return null;
    }
    for (const candidate of sampleTokenCandidates(ctx.token.text, cursorOffset)) {
      const group =
        findIndexedGroupItem(data, "sample_fetches", candidate) ??
        findIndexedGroupItem(data, "acl_criteria", candidate) ??
        findGroupItem(data, candidate);
      if (group) {
        return new vscode.Hover(
          hoverMarkdown(
            group.name,
            group.signature,
            group.description,
            [],
            group.docsUrl,
            group.examples,
          ),
          range,
        );
      }
    }
  }

  if (ctx.kind === "expression-fetch" || ctx.kind === "expression-converter") {
    if (ctx.token.text.startsWith("-")) {
      return null;
    }
    for (const candidate of sampleTokenCandidates(ctx.token.text, cursorOffset)) {
      const group =
        (ctx.kind === "expression-fetch"
          ? findIndexedGroupItem(data, "sample_fetches", candidate)
          : findIndexedGroupItem(data, "sample_converters", candidate)) ??
        findGroupItem(data, candidate);
      if (group) {
        return new vscode.Hover(
          hoverMarkdown(
            group.name,
            group.signature,
            group.description,
            [],
            group.docsUrl,
            group.examples,
          ),
          range,
        );
      }
    }
  }

  return null;
}
