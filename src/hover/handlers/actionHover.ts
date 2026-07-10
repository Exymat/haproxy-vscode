import * as vscode from "vscode";

import { findIndexedGroupItem } from "../../languageDataIndexes";
import { actionGroupForCompletionKind, actionGroupNames } from "../../schema/semantic";
import { normalizeActionName } from "../../tokenUtils";
import { sampleTokenCandidates } from "../helpers";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

function actionNameCandidates(hc: HoverContext): string[] {
  const token = hc.ctx.token.text;
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string): void => {
    const lower = value.toLowerCase();
    if (!lower || seen.has(lower)) {
      return;
    }
    seen.add(lower);
    out.push(lower);
  };

  for (const candidate of sampleTokenCandidates(token, hc.cursorOffset)) {
    push(normalizeActionName(candidate));
  }
  push(normalizeActionName(token));
  return out;
}

function actionGroupsToSearch(hc: HoverContext): string[] {
  const actionGroups = actionGroupNames(hc.schema);
  const preferred = actionGroupForCompletionKind(hc.schema, hc.ctx.kind);
  if (!preferred) {
    return actionGroups;
  }
  return [preferred, ...actionGroups.filter((group) => group !== preferred)];
}

export function tryActionHover(hc: HoverContext): vscode.Hover | null {
  const { data, range } = hc;

  for (const candidate of actionNameCandidates(hc)) {
    for (const groupName of actionGroupsToSearch(hc)) {
      const group = findIndexedGroupItem(data, groupName, candidate);
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
  }

  return null;
}
