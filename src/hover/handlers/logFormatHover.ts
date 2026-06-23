import * as vscode from "vscode";

import { logFormatContextAt, logFormatItemAtOffset } from "../../logFormat";
import { findGroupItemIn } from "../helpers";
import { hoverMarkdown } from "../markdown";
import { HoverContext } from "../types";

export function tryLogFormatHover(hc: HoverContext): vscode.Hover | null {
  const { document, position, data, schema, ctx } = hc;

  const lineText = document.lineAt(position.line).text;
  const fmtContext = logFormatContextAt(lineText, ctx.line.tokens, position.character, schema);
  if (!fmtContext) {
    return null;
  }

  const { region, localOffset } = fmtContext;
  const item = logFormatItemAtOffset(region.text, localOffset);
  if (!item) {
    return null;
  }

  if (item.kind === "alias" && item.alias) {
    const aliasDoc =
      findGroupItemIn(data, "logformat_aliases", item.alias) ??
      findGroupItemIn(data, "logformat_aliases", item.alias.toLowerCase());
    const schemaAlias = schema.logformat_aliases?.[item.alias];
    if (!aliasDoc && !schemaAlias) {
      return null;
    }

    const description = aliasDoc?.description ?? schemaAlias?.field_name ?? "";
    const range = new vscode.Range(
      position.line,
      region.start + item.start,
      position.line,
      region.start + item.end,
    );

    return new vscode.Hover(
      hoverMarkdown(item.alias, item.alias, description, [], aliasDoc?.docsUrl),
      range,
    );
  }

  if (item.flags?.length) {
    for (const flag of item.flags) {
      const flagDoc = findGroupItemIn(data, "logformat_flags", flag);
      if (!flagDoc) {
        continue;
      }
      const flagNeedle = `+${flag}`;
      const braceStart = region.text.lastIndexOf("{", localOffset);
      const braceBody = braceStart >= 0 ? region.text.slice(braceStart + 1) : "";
      const flagOffset = braceBody.indexOf(flagNeedle);
      if (flagOffset < 0) {
        continue;
      }
      const absStart = region.start + braceStart + 1 + flagOffset + 1;
      if (position.character < absStart || position.character > absStart + flag.length) {
        continue;
      }
      return new vscode.Hover(
        hoverMarkdown(flag, `+${flag}`, flagDoc.description, []),
        new vscode.Range(position.line, absStart, position.line, absStart + flag.length),
      );
    }
  }

  return null;
}
