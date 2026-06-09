import * as vscode from "vscode";

import { findArgumentValue } from "../../directiveUtils";
import { groupItems } from "../../documentContext";
import { findStatementRule } from "../../statementLayout";
import { lineOptionChapter, resolveNestedLineOptionSpan } from "../lineOptions";
import { addContextExtra, escapeMarkdownText, hoverMarkdown, signaturesBlock } from "../markdown";
import { HoverContext } from "../types";

export function tryLineOptionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema, range, tokenLower } = hc;

  const lineOptionGroup =
    ctx.kind === "bind" ? "bind_options" : ctx.kind === "server" ? "server_options" : null;
  const lineOptionRule = lineOptionGroup ? findStatementRule(schema, ctx.line) : undefined;
  const lineOptionStart = lineOptionRule?.nested_start_index ?? -1;
  if (!lineOptionGroup || lineOptionStart < 0 || ctx.tokenIndex < lineOptionStart) {
    return null;
  }

  const active = resolveNestedLineOptionSpan(schema, ctx, lineOptionGroup, lineOptionStart);
  const effectiveKeyword = active?.keyword ?? tokenLower;
  const group = groupItems(data, lineOptionGroup).find(
    (g) => g.name.toLowerCase() === effectiveKeyword,
  );
  if (!group?.description) {
    return null;
  }

  const chapter = ctx.kind === "bind" || ctx.kind === "server" ? lineOptionChapter(ctx.kind) : "";
  const schemaOption = schema.keywords[effectiveKeyword];
  const schemaVariant = chapter
    ? schemaOption?.variants?.find((variant) => variant.chapter === chapter)
    : undefined;
  const signatures = schemaVariant?.signatures?.length
    ? schemaVariant.signatures
    : group.signature
      ? [group.signature]
      : [group.name];
  const extras: string[] = [];
  const argumentHover =
    active && ctx.tokenIndex > active.optionIndex
      ? findArgumentValue(schemaVariant?.arguments ?? schemaOption?.arguments, ctx.token.text)
      : undefined;
  addContextExtra(extras, schema.keyword_group_contexts?.[lineOptionGroup]?.[effectiveKeyword]);
  if (argumentHover) {
    extras.push(`**Nested option:** ${escapeMarkdownText(group.name)}`);
    return new vscode.Hover(
      hoverMarkdown(argumentHover.name, "", argumentHover.description, extras, group.docsUrl),
      range,
    );
  }
  if (signatures.length > 1) {
    extras.unshift(`**Forms:**\n${signaturesBlock(signatures)}`);
    return new vscode.Hover(
      hoverMarkdown(group.name, "", group.description, extras, group.docsUrl),
      range,
    );
  }
  return new vscode.Hover(
    hoverMarkdown(
      group.name,
      signatures[0] ?? group.name,
      group.description,
      extras,
      group.docsUrl,
    ),
    range,
  );
}
