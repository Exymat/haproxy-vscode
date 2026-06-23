import * as vscode from "vscode";

import { groupItems } from "../../documentContext";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

const actionGroups = [
  "http_request_actions",
  "http_response_actions",
  "http_after_response_actions",
  "tcp_request_actions",
  "tcp_response_actions",
] as const;

export function tryActionHover(hc: HoverContext): vscode.Hover | null {
  const { data, range, tokenLower } = hc;

  for (const groupName of actionGroups) {
    const group = groupItems(data, groupName).find((g) => g.name.toLowerCase() === tokenLower);
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
