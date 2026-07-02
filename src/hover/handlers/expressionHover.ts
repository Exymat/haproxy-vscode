import * as vscode from "vscode";

import { CompletionKind } from "../../documentContext";
import { findIndexedGroupItem } from "../../languageDataIndexes";
import { LanguageGroupItem } from "../../languageData";
import { findGroupItem, sampleTokenCandidates } from "../helpers";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

const RULE_KINDS = new Set<CompletionKind>([
  "http-request",
  "http-response",
  "http-after-response",
  "tcp-request",
  "tcp-response",
]);

function sampleGroupHover(
  hc: HoverContext,
  groups: Array<"sample_fetches" | "sample_converters" | "acl_criteria">,
): vscode.Hover | null {
  const { ctx, data, range, cursorOffset } = hc;
  if (!ctx.token || ctx.token.text.startsWith("-")) {
    return null;
  }

  for (const candidate of sampleTokenCandidates(ctx.token.text, cursorOffset)) {
    let group: LanguageGroupItem | undefined;
    for (const groupName of groups) {
      group = findIndexedGroupItem(data, groupName, candidate);
      if (group) {
        break;
      }
    }
    group ??= findGroupItem(data, candidate);
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

  return null;
}

export function tryExpressionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx } = hc;

  if (ctx.kind === "acl-criterion" && ctx.tokenIndex >= 2) {
    return sampleGroupHover(hc, ["sample_fetches", "acl_criteria"]);
  }

  if (ctx.kind === "expression-fetch") {
    return sampleGroupHover(hc, ["sample_fetches"]);
  }

  if (ctx.kind === "expression-converter") {
    return sampleGroupHover(hc, ["sample_converters"]);
  }

  if (RULE_KINDS.has(ctx.kind) && ctx.tokenIndex >= 2) {
    return sampleGroupHover(hc, ["sample_fetches", "sample_converters", "acl_criteria"]);
  }

  return null;
}
