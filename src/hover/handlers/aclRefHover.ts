import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

const aclRefGroups = [
  "acl_flags",
  "acl_match_methods",
  "acl_int_operators",
  "acl_string_match_methods",
  "acl_predefined",
] as const;

export function tryAclRefHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, range, tokenLower } = hc;

  for (const groupName of aclRefGroups) {
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
