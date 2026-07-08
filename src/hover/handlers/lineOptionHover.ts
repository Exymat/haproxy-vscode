import * as vscode from "vscode";

import { findArgumentValue, getKeywordFromSchema } from "../../directiveUtils";
import { findIndexedGroupItem } from "../../languageDataIndexes";
import { lineOptionGroupForKind } from "../../schema";
import { findStatementRule } from "../../statementLayout";
import { findGroupItem } from "../helpers";
import { lineOptionChapter } from "../../lineOptionKeyword";
import { resolveLineOptionStartIndex, resolveNestedLineOptionSpan } from "../../lineOptionSpan";
import { addContextExtra, escapeMarkdownText, hoverMarkdown, signaturesBlock } from "../markdown";
import { HoverContext } from "../types";

export function tryLineOptionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema, range, tokenLower } = hc;

  const lineOptionGroup = lineOptionGroupForKind(schema, ctx.kind);
  const lineOptionRule = lineOptionGroup
    ? (hc.analyzed?.statement.rule ?? findStatementRule(schema, ctx.line))
    : undefined;
  const lineOptionStart = resolveLineOptionStartIndex(schema, ctx.line, lineOptionRule);
  if (!lineOptionGroup || lineOptionStart < 0 || ctx.tokenIndex < lineOptionStart) {
    return null;
  }

  const active = resolveNestedLineOptionSpan(schema, ctx, lineOptionGroup, lineOptionStart);
  const effectiveKeyword = active?.keyword ?? tokenLower;
  const group = findIndexedGroupItem(data, lineOptionGroup, effectiveKeyword);

  const chapter = ctx.kind === "bind" || ctx.kind === "server" ? lineOptionChapter(ctx.kind) : "";
  const schemaOption = schema.keywords[effectiveKeyword];
  const schemaVariant = chapter
    ? schemaOption?.variants?.find((variant) => variant.chapter === chapter)
    : undefined;
  const argumentHover =
    active && ctx.tokenIndex > active.optionIndex
      ? findArgumentValue(schemaVariant?.arguments ?? schemaOption?.arguments, ctx.token.text)
      : undefined;

  if (argumentHover && group) {
    const extras: string[] = [];
    addContextExtra(extras, schema.keyword_group_contexts?.[lineOptionGroup]?.[effectiveKeyword]);
    extras.push(`**Nested option:** ${escapeMarkdownText(group.name)}`);
    return new vscode.Hover(
      hoverMarkdown(
        argumentHover.name,
        "",
        argumentHover.description,
        extras,
        group.docsUrl,
        group.examples,
      ),
      range,
    );
  }

  if (active && ctx.tokenIndex > active.optionIndex && tokenLower !== active.keyword) {
    const nestedGroup = findGroupItem(data, tokenLower);
    if (nestedGroup?.description || nestedGroup?.examples?.length) {
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
          nestedGroup.examples,
        ),
        range,
      );
    }
  }

  if (!group?.description && !group?.examples?.length) {
    return null;
  }

  const signatures = schemaVariant?.signatures?.length
    ? schemaVariant.signatures
    : group.signature
      ? [group.signature]
      : [group.name];
  const extras: string[] = [];
  addContextExtra(extras, schema.keyword_group_contexts?.[lineOptionGroup]?.[effectiveKeyword]);
  if (signatures.length > 1) {
    extras.unshift(signaturesBlock(signatures));
    extras.unshift("**Forms:**");
    return new vscode.Hover(
      hoverMarkdown(group.name, "", group.description, extras, group.docsUrl, group.examples),
      range,
    );
  }
  return new vscode.Hover(
    hoverMarkdown(
      group.name,
      signatures[0],
      group.description,
      extras,
      group.docsUrl,
      group.examples,
    ),
    range,
  );
}
