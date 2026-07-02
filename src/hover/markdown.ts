import * as vscode from "vscode";

import type { LanguageExample } from "../languageData";
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

function appendExamples(md: vscode.MarkdownString, examples: LanguageExample[] | undefined): void {
  if (!examples?.length) {
    return;
  }
  for (const example of examples) {
    appendFormattedBlock(md, exampleBlock(example));
  }
}

export function exampleBlock(example: LanguageExample): string {
  const heading = example.title ? `**Example:** ${example.title}` : "**Example**";
  return [heading, "", "```haproxy", example.code, "```"].join("\n");
}

export function hoverMarkdown(
  title: string,
  signature: string,
  description: string,
  extras: string[],
  docsUrl?: string,
  examples?: LanguageExample[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${title}**`);
  if (signature) {
    md.appendMarkdown(`\n\n\`${signature}\``);
  }
  appendFormattedText(md, description);
  appendExamples(md, examples);
  for (const line of extras) {
    appendFormattedText(md, line);
  }
  if (docsUrl) {
    md.appendMarkdown(`\n\n[HAProxy documentation](${docsUrl})`);
  }
  return md;
}

export function languageDocMarkdown(
  description: string,
  docsUrl?: string,
  examples?: LanguageExample[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  appendFormattedText(md, description);
  appendExamples(md, examples);
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

function escapeMarkdownInlineCode(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

export function formatParameterExtra(parameter: string): string {
  const label = escapeMarkdownInlineCode(parameter.trim() || "argument");
  return `**Parameter:** \`${label}\``;
}

export function addSectionExtra(extras: string[], sections: string[] | undefined): void {
  if (!sections || sections.length === 0) {
    return;
  }
  extras.push(`**Valid in sections:** ${sections.join(", ")}`);
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
      /* v8 ignore start -- duplicate display forms are deduplicated defensively before hover rendering */
      if (!names.includes(value.name)) {
        names.push(value.name);
      }
      /* v8 ignore stop */
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
