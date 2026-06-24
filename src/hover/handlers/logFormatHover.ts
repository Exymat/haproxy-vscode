import * as vscode from "vscode";

import { logFormatContextAt, logFormatFlagAtOffset, logFormatItemAtOffset } from "../../logFormat";
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

  const flagSpan = logFormatFlagAtOffset(region.text, localOffset);
  if (flagSpan) {
    const flagDoc = findGroupItemIn(data, "logformat_flags", flagSpan.flag);
    if (flagDoc) {
      return new vscode.Hover(
        hoverMarkdown(flagSpan.flag, `${flagSpan.sign}${flagSpan.flag}`, flagDoc.description, []),
        new vscode.Range(
          position.line,
          region.start + flagSpan.start,
          position.line,
          region.start + flagSpan.end,
        ),
      );
    }
  }

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

  return null;
}
