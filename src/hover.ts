import * as vscode from "vscode";

import {
  argumentPosition,
  findArgumentValue,
  getKeywordFromLanguage,
  resolveDirective,
} from "./directiveUtils";
import { getDocumentContext, groupItems, keywordsForSection } from "./documentContext";
import { findKeywordByPrefix, HaproxyLanguageData, LanguageGroupItem } from "./languageData";
import { HaproxySchema } from "./schema";

function hoverMarkdown(
  title: string,
  signature: string,
  description: string,
  extras: string[],
  docsUrl?: string
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${title}**`);
  if (signature) {
    md.appendMarkdown(`\n\n\`${signature}\``);
  }
  if (description) {
    md.appendMarkdown(`\n\n${description}`);
  }
  for (const line of extras) {
    md.appendMarkdown(`\n\n${line}`);
  }
  if (docsUrl) {
    md.appendMarkdown(`\n\n[HAProxy documentation](${docsUrl})`);
  }
  return md;
}

function findGroupItem(data: HaproxyLanguageData, name: string): LanguageGroupItem | undefined {
  const lower = name.toLowerCase();
  for (const items of Object.values(data.groups)) {
    const hit = items.find((item) => item.name.toLowerCase() === lower);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function signaturesBlock(signatures: string[]): string {
  if (signatures.length === 0) {
    return "";
  }
  if (signatures.length === 1) {
    return signatures[0];
  }
  return signatures.map((sig) => `- \`${sig}\``).join("\n");
}

export function provideHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  data: HaproxyLanguageData,
  schema: HaproxySchema
): vscode.Hover | null {
  const ctx = getDocumentContext(document, position, schema);
  if (!ctx || !ctx.token) {
    return null;
  }

  const range = new vscode.Range(
    ctx.line.line,
    ctx.token.start,
    ctx.line.line,
    ctx.token.end
  );

  const tokenLower = ctx.token.text.toLowerCase();

  if (ctx.kind === "option" && ctx.tokenIndex >= 1) {
    const group = groupItems(data, "options").find((g) => g.name.toLowerCase() === tokenLower);
    if (group) {
      return new vscode.Hover(
        hoverMarkdown(group.name, "option " + group.name, group.description, []),
        range
      );
    }
  }

  const actionGroups = [
    "http_request_actions",
    "http_response_actions",
    "http_after_response_actions",
    "tcp_request_actions",
    "tcp_response_actions",
  ] as const;
  for (const groupName of actionGroups) {
    const group = groupItems(data, groupName).find((g) => g.name.toLowerCase() === tokenLower);
    if (group) {
      const extras: string[] = [];
      if (group.rulesets.length > 0) {
        extras.push(`**Rulesets:** ${group.rulesets.join(", ")}`);
      }
      return new vscode.Hover(
        hoverMarkdown(group.name, group.signature, group.description, extras),
        range
      );
    }
  }

  if (ctx.kind === "acl-criterion" && ctx.tokenIndex >= 2) {
    const group = findGroupItem(data, ctx.token.text);
    if (group) {
      return new vscode.Hover(hoverMarkdown(group.name, group.signature, group.description, []), range);
    }
  }

  const sectionKeywords = keywordsForSection(data, ctx.line.section);
  const allowed = new Set(sectionKeywords.map((kw) => kw.name.toLowerCase()));
  const directive = resolveDirective(ctx.line, allowed);

  if (directive.matched && ctx.tokenIndex > directive.end) {
    const kw = getKeywordFromLanguage(data, directive.keyword);
    const argValue = findArgumentValue(kw?.arguments, ctx.token.text);
    if (argValue) {
      const extras: string[] = [];
      if (argValue.parameter) {
        extras.push(`**Parameter:** ${argValue.parameter}`);
      }
      if (kw) {
        extras.push(`**Directive:** ${kw.name}`);
      }
      return new vscode.Hover(
        hoverMarkdown(argValue.name, "", argValue.description, extras, kw?.docsUrl),
        range
      );
    }
  }

  const combined = ctx.line.tokens
    .slice(0, Math.min(ctx.tokenIndex + 1, 4))
    .map((t) => t.text)
    .join(" ");
  const kw =
    findKeywordByPrefix(data, combined) ??
    (directive.matched ? getKeywordFromLanguage(data, directive.keyword) : undefined);

  if (!kw) {
    const group = findGroupItem(data, ctx.token.text);
    if (group) {
      return new vscode.Hover(hoverMarkdown(group.name, group.signature, group.description, []), range);
    }
    return null;
  }

  const onDirectiveToken = ctx.tokenIndex <= directive.end;
  const extras: string[] = [];
  if (kw.sections.length > 0) {
    extras.push(`**Valid in:** ${kw.sections.join(", ")}`);
  }

  if (onDirectiveToken) {
    if (kw.signatures.length > 1) {
      extras.unshift(`**Forms:**\n${signaturesBlock(kw.signatures)}`);
      return new vscode.Hover(hoverMarkdown(kw.name, "", kw.description, extras, kw.docsUrl), range);
    }
    return new vscode.Hover(
      hoverMarkdown(kw.name, kw.signatures[0] ?? kw.name, kw.description, extras, kw.docsUrl),
      range
    );
  }

  const pos = argumentPosition(ctx.tokenIndex, directive.end);
  const param = kw.arguments?.[Math.min(pos, (kw.arguments?.length ?? 1) - 1)];
  if (param?.description) {
    extras.push(`**Parameter:** ${param.parameter || "argument"}`);
    extras.push(param.description);
  }

  return new vscode.Hover(
    hoverMarkdown(kw.name, kw.signatures[0] ?? kw.name, kw.description, extras, kw.docsUrl),
    range
  );
}
