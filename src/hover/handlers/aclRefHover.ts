/** Provides hover docs for ACL criteria, flags, and related references. */
import * as vscode from "vscode";

import { groupItems } from "../../parser/documentContext";
import { hoverMarkdown } from "../markdown";
import { aclRefGroupNames } from "../../schema/semantic";
import { HoverContext } from "../types";

function previousTokenText(hc: HoverContext): string {
  return hc.ctx.line.tokens[hc.ctx.tokenIndex - 1]?.text.toLowerCase() ?? "";
}

function firstTokenText(hc: HoverContext): string {
  return hc.ctx.line.tokens[0]?.text.toLowerCase() ?? "";
}

export function aclRefGroupApplies(hc: HoverContext, groupName: string): boolean {
  const prev = previousTokenText(hc);
  switch (groupName) {
    case "acl_match_methods":
    case "acl_string_match_methods":
      return prev === "-m";
    case "acl_flags":
      return hc.ctx.token.text.startsWith("-");
    case "acl_int_operators":
      return hc.ctx.kind === "acl-criterion" || firstTokenText(hc) === "acl" || prev === "-m";
    case "acl_predefined":
      return hc.ctx.kind === "acl-criterion" || firstTokenText(hc) === "acl";
    default:
      return true;
  }
}

export function tryAclRefHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range, tokenLower } = hc;

  for (const groupName of aclRefGroupNames(hc.schema)) {
    if (!aclRefGroupApplies(hc, groupName)) {
      continue;
    }
    const items = groupItems(data, groupName);
    const group =
      items.find((g) => g.name === ctx.token.text) ??
      (groupName === "acl_flags"
        ? undefined
        : items.find((g) => g.name.toLowerCase() === tokenLower));
    if (group) {
      return new vscode.Hover(
        hoverMarkdown(group.name, group.signature, group.description, []),
        range,
      );
    }
  }

  return null;
}
