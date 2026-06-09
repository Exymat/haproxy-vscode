import * as vscode from "vscode";

import { formatHoverBlocks } from "./formatHoverText";

function appendFormattedBlock(md: vscode.MarkdownString, text: string): void {
  md.appendMarkdown(`\n\n${text}`);
}

function appendFormattedText(md: vscode.MarkdownString, text: string): void {
  if (!text) {
    return;
  }
  if (text.includes("```")) {
    appendFormattedBlock(md, text);
    return;
  }
  for (const block of formatHoverBlocks(text)) {
    appendFormattedBlock(md, block);
  }
}

export function hoverMarkdown(
  title: string,
  signature: string,
  description: string,
  extras: string[],
  docsUrl?: string,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${title}**`);
  if (signature) {
    md.appendMarkdown(`\n\n\`${signature}\``);
  }
  appendFormattedText(md, description);
  for (const line of extras) {
    appendFormattedText(md, line);
  }
  if (docsUrl) {
    md.appendMarkdown(`\n\n[HAProxy documentation](${docsUrl})`);
  }
  return md;
}

export function signaturesBlock(signatures: string[]): string {
  return ["```haproxy", ...signatures, "```"].join("\n");
}

export function escapeMarkdownText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatParameterExtra(parameter: string): string {
  const label = (parameter.trim() || "argument").replace(/`/g, "\\`");
  return `**Parameter:** \`${label}\``;
}

export function matchingArgumentValueNames(
  params:
    | Array<{
        parameter: string;
        values: Array<{ name: string; description: string }>;
      }>
    | undefined,
  tokenText: string,
): string[] {
  if (!params) {
    return [];
  }
  const key = tokenText.toLowerCase().split("(", 1)[0];
  const names: string[] = [];
  for (const param of params) {
    for (const value of param.values) {
      if (value.name.toLowerCase().split("(", 1)[0] !== key) {
        continue;
      }
      if (!names.includes(value.name)) {
        names.push(value.name);
      }
    }
  }
  return names;
}

export function addContextExtra(extras: string[], contexts: string[] | undefined): void {
  if (!contexts || contexts.length === 0) {
    return;
  }
  extras.push(`**Valid in modes:** ${contexts.join(", ")}`);
}
