import * as vscode from "vscode";

import { ACTION_GROUP_NAMES } from "../../domainMaps";
import { findIndexedGroupItem } from "../../languageDataIndexes";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

const actionGroups = ACTION_GROUP_NAMES;

export function tryActionHover(hc: HoverContext): vscode.Hover | null {
  const { data, range, tokenLower } = hc;

  for (const groupName of actionGroups) {
    const group = findIndexedGroupItem(data, groupName, tokenLower);
    if (group) {
      const extras: string[] = [];
      if (group.rulesets.length > 0) {
        extras.push(`**Rulesets:** ${group.rulesets.join(", ")}`);
      }
      return new vscode.Hover(
        hoverMarkdown(
          group.name,
          group.signature,
          group.description,
          extras,
          group.docsUrl,
          group.examples,
        ),
        range,
      );
    }
  }

  return null;
}
