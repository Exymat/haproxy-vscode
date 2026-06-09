import * as vscode from "vscode";

import { findArgumentValue, getKeywordFromSchema } from "../../directiveUtils";
import { groupItems } from "../../documentContext";
import { findStatementRule } from "../../statementLayout";
import { findGroupItem } from "../helpers";
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
  if (active && ctx.tokenIndex > active.optionIndex && tokenLower !== active.keyword) {
    const nestedGroup = findGroupItem(data, tokenLower);
    if (nestedGroup?.description) {
      const nestedSchemaKeyword = getKeywordFromSchema(schema, tokenLower, ctx.line.section);
      const nestedExtras: string[] = [];
      addContextExtra(nestedExtras, nestedSchemaKeyword?.contexts);
      return new vscode.Hover(
        hoverMarkdown(
          nestedGroup.name,
          nestedGroup.signature ?? nestedGroup.name,
          nestedGroup.description,
          nestedExtras,
          nestedGroup.docsUrl,
        ),
        range,
      );
    }
  }
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
    extras.unshift(signaturesBlock(signatures));
    extras.unshift("**Forms:**");
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
