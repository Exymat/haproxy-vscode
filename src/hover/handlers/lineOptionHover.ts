/** Provides hover docs for nested line options and their arguments. */
import * as vscode from "vscode";

import { findArgumentValue, getKeywordFromSchema } from "../../language/directiveUtils";
import { findIndexedGroupItem } from "../../language/languageDataIndexes";
import { LanguageGroupItem } from "../../language/languageData";
import { lineOptionGroupForKind } from "../../schema/semantic";
import { findStatementRule } from "../../schema/statementLayout";
import { findGroupItem } from "../helpers";
import { lineOptionChapter } from "../../language/lineOptionKeyword";
import {
  resolveLineOptionStartIndex,
  resolveNestedLineOptionSpan,
} from "../../language/lineOptionSpan";
import { addContextExtra, escapeMarkdownText, hoverMarkdown, signaturesBlock } from "../markdown";
import { HoverContext } from "../types";

function hoverForArgumentValue(
  hc: HoverContext,
  lineOptionGroup: string,
  effectiveKeyword: string,
  argumentHover: NonNullable<ReturnType<typeof findArgumentValue>>,
  group: NonNullable<ReturnType<typeof findIndexedGroupItem>>,
): vscode.Hover {
  const extras: string[] = [];
  addContextExtra(extras, hc.schema.keyword_group_contexts?.[lineOptionGroup]?.[effectiveKeyword]);
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
    hc.range,
  );
}

function hoverForNestedGroup(hc: HoverContext): vscode.Hover | null {
  const nestedGroup = findGroupItem(hc.data, hc.tokenLower);
  if (!nestedGroup?.description && !nestedGroup?.examples?.length) {
    return null;
  }
  const nestedSchemaKeyword = getKeywordFromSchema(hc.schema, hc.tokenLower, hc.ctx.line.section);
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
    hc.range,
  );
}

function hoverForLineOptionGroup(
  hc: HoverContext,
  lineOptionGroup: string,
  effectiveKeyword: string,
  group: NonNullable<ReturnType<typeof findIndexedGroupItem>>,
  schemaVariant: { signatures?: string[] } | undefined,
): vscode.Hover {
  const signatures = schemaVariant?.signatures?.length
    ? schemaVariant.signatures
    : group.signature
      ? [group.signature]
      : [group.name];
  const extras: string[] = [];
  addContextExtra(extras, hc.schema.keyword_group_contexts?.[lineOptionGroup]?.[effectiveKeyword]);
  if (signatures.length > 1) {
    extras.unshift(signaturesBlock(signatures));
    extras.unshift("**Forms:**");
    return new vscode.Hover(
      hoverMarkdown(group.name, "", group.description, extras, group.docsUrl, group.examples),
      hc.range,
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
    hc.range,
  );
}

function groupHasHoverDocs(group: LanguageGroupItem | undefined): group is LanguageGroupItem {
  return Boolean(group?.description) || Boolean(group?.examples?.length);
}

function lineOptionRuleForHover(hc: HoverContext, lineOptionGroup: string | null | undefined) {
  if (!lineOptionGroup) {
    return undefined;
  }
  return hc.analyzed?.statement.rule ?? findStatementRule(hc.schema, hc.ctx.line);
}

function schemaVariantForChapter(
  schemaOption: HoverContext["schema"]["keywords"][string] | undefined,
  chapter: string,
) {
  if (!chapter) {
    return undefined;
  }
  return schemaOption?.variants?.find((variant) => variant.chapter === chapter);
}

function argumentValueForNestedOption(
  hc: HoverContext,
  active: ReturnType<typeof resolveNestedLineOptionSpan>,
  schemaVariant: ReturnType<typeof schemaVariantForChapter>,
  schemaOption: HoverContext["schema"]["keywords"][string] | undefined,
) {
  if (!active || hc.ctx.tokenIndex <= active.optionIndex) {
    return undefined;
  }
  return findArgumentValue(schemaVariant?.arguments ?? schemaOption?.arguments, hc.ctx.token.text);
}

export function tryLineOptionHover(hc: HoverContext): vscode.Hover | null {
  const { ctx, data, schema, tokenLower } = hc;

  const lineOptionGroup = lineOptionGroupForKind(schema, ctx.kind);
  const lineOptionRule = lineOptionRuleForHover(hc, lineOptionGroup);
  const lineOptionStart = resolveLineOptionStartIndex(schema, ctx.line, lineOptionRule);
  if (!lineOptionGroup || lineOptionStart < 0 || ctx.tokenIndex < lineOptionStart) {
    return null;
  }

  const active = resolveNestedLineOptionSpan(schema, ctx, lineOptionGroup, lineOptionStart);
  const effectiveKeyword = active?.keyword ?? tokenLower;
  const group = findIndexedGroupItem(data, lineOptionGroup, effectiveKeyword);
  const chapter = lineOptionChapter(schema, ctx.kind) ?? "";
  const schemaOption = schema.keywords[effectiveKeyword];
  const schemaVariant = schemaVariantForChapter(schemaOption, chapter);
  const argumentHover = argumentValueForNestedOption(hc, active, schemaVariant, schemaOption);

  if (argumentHover && group) {
    return hoverForArgumentValue(hc, lineOptionGroup, effectiveKeyword, argumentHover, group);
  }

  if (active && ctx.tokenIndex > active.optionIndex && tokenLower !== active.keyword) {
    const nested = hoverForNestedGroup(hc);
    if (nested) {
      return nested;
    }
  }

  if (!groupHasHoverDocs(group)) {
    return null;
  }

  return hoverForLineOptionGroup(hc, lineOptionGroup, effectiveKeyword, group, schemaVariant);
}
