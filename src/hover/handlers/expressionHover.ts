import * as vscode from "vscode";

import { CompletionKind } from "../../documentContext";
import { ACTION_GROUP_NAMES, actionGroupForCompletionKind } from "../../domainMaps";
import { findIndexedGroupItem } from "../../languageDataIndexes";
import { LanguageGroupItem } from "../../languageData";
import { normalizeActionName } from "../../tokenUtils";
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

const EXPRESSION_GROUPS = ["sample_fetches", "sample_converters", "acl_criteria"] as const;

function isInExpressionGroups(data: HoverContext["data"], candidate: string): boolean {
  for (const groupName of EXPRESSION_GROUPS) {
    if (findIndexedGroupItem(data, groupName, candidate)) {
      return true;
    }
  }
  return false;
}

function isActionToken(
  data: HoverContext["data"],
  candidate: string,
  kind: CompletionKind,
): boolean {
  const actionName = normalizeActionName(candidate);
  const preferred = actionGroupForCompletionKind(kind);
  const groups = preferred
    ? [preferred, ...ACTION_GROUP_NAMES.filter((group) => group !== preferred)]
    : ACTION_GROUP_NAMES;
  for (const group of groups) {
    if (findIndexedGroupItem(data, group, actionName)) {
      return true;
    }
  }
  return false;
}

function resolvesAsSampleFetch(hc: HoverContext): boolean {
  const { ctx, data, cursorOffset } = hc;
  if (!ctx.token || ctx.token.text.startsWith("-")) {
    return false;
  }

  for (const candidate of sampleTokenCandidates(ctx.token.text, cursorOffset)) {
    if (isInExpressionGroups(data, candidate) && !isActionToken(data, candidate, ctx.kind)) {
      return true;
    }
  }
  return false;
}

function isSampleLikeArgument(hc: HoverContext): boolean {
  const tokenText = hc.ctx.token?.text ?? "";
  return tokenText.includes(".") || tokenText.includes("(");
}

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

  const isSampleFetchArgument = resolvesAsSampleFetch(hc);
  if (RULE_KINDS.has(ctx.kind)) {
    const minIndex = isSampleFetchArgument ? 1 : 2;
    if (ctx.tokenIndex >= minIndex) {
      return sampleGroupHover(hc, ["sample_fetches", "sample_converters", "acl_criteria"]);
    }
  }

  if (isSampleFetchArgument && ctx.tokenIndex > 0 && isSampleLikeArgument(hc)) {
    return sampleGroupHover(hc, ["sample_fetches", "sample_converters", "acl_criteria"]);
  }

  return null;
}
