/** Provides hover docs for ACL criteria, flags, and related references. */
import * as vscode from "vscode";

import { groupItems } from "../../parser/documentContext";
import { aclRefGroupApplies } from "../helpers";
import { hoverMarkdown } from "../markdown";
import { aclRefGroupNames } from "../../schema/semantic";
import { HoverContext } from "../types";

export { aclRefGroupApplies } from "../helpers";

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
