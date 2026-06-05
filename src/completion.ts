import * as vscode from "vscode";

import {
  argumentPosition,
  completionValuesForPosition,
  getKeywordFromSchema,
  resolveDirective,
} from "./directiveUtils";
import {
  getDocumentContext,
  getSectionKeywords,
  groupItems,
  keywordsForSection,
} from "./documentContext";
import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema, modifierPrefixSet } from "./schema";

function markdownDoc(description: string, docsUrl?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  if (description) {
    md.appendMarkdown(description);
  }
  if (docsUrl) {
    md.appendMarkdown(`\n\n[HAProxy documentation](${docsUrl})`);
  }
  return md;
}

function filterByPrefix(items: string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  if (!p) {
    return items;
  }
  return items.filter((item) => item.toLowerCase().startsWith(p));
}

export function provideCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  data: HaproxyLanguageData,
  schema: HaproxySchema
): vscode.CompletionItem[] {
  const ctx = getDocumentContext(document, position, schema);
  if (!ctx) {
    return [];
  }

  const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_.-]+/);
  const partial = wordRange ? document.getText(wordRange) : "";

  if (ctx.kind === "section" && ctx.line.tokens.length === 0) {
    return getSectionKeywords(schema).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
      item.detail = "HAProxy section";
      return item;
    });
  }

  if (ctx.kind === "option") {
    const options = groupItems(data, "options").map((g) => g.name);
    return filterByPrefix(options, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      const group = groupItems(data, "options").find((g) => g.name === name);
      item.detail = "option";
      const optKeyword =
        data.keywords[`option ${name}`.toLowerCase()] ??
        data.keywords[`no option ${name}`.toLowerCase()];
      if (optKeyword?.description || group?.description) {
        item.documentation = markdownDoc(
          optKeyword?.description ?? group?.description ?? "",
          optKeyword?.docsUrl ?? group?.docsUrl
        );
      }
      return item;
    });
  }

  const actionGroupForKind = (kind: string): string | null => {
    switch (kind) {
      case "http-request":
        return "http_request_actions";
      case "http-response":
        return "http_response_actions";
      case "http-after-response":
        return "http_after_response_actions";
      case "tcp-request":
        return "tcp_request_actions";
      case "tcp-response":
        return "tcp_response_actions";
      default:
        return null;
    }
  };

  if (
    (ctx.kind === "http-request" ||
      ctx.kind === "http-response" ||
      ctx.kind === "tcp-request" ||
      ctx.kind === "tcp-response") &&
    ctx.tokenIndex >= 2 &&
    ctx.line.tokens[1]?.text.toLowerCase() === "use-service"
  ) {
    const services = groupItems(data, "services").map((g) => g.name);
    return filterByPrefix(services, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      item.detail = "service";
      return item;
    });
  }

  const actionKind = actionGroupForKind(ctx.kind);
  if (actionKind) {
    const actions = groupItems(data, actionKind).map((g) => g.name);
    return filterByPrefix(actions, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
      const group = groupItems(data, actionKind).find((g) => g.name === name);
      item.detail = ctx.kind;
      if (group?.description) {
        item.documentation = markdownDoc(group.description, group.docsUrl);
      }
      return item;
    });
  }

  if (ctx.kind === "filter") {
    const filters = groupItems(data, "filters").map((g) => g.name);
    return filterByPrefix(filters, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      item.detail = "filter";
      return item;
    });
  }

  if (ctx.kind === "expression-fetch" || ctx.kind === "expression-converter") {
    const groupName = ctx.kind === "expression-converter" ? "sample_converters" : "sample_fetches";
    const names = groupItems(data, groupName).map((g) => g.name);
    return filterByPrefix(names, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.detail = groupName.replace("sample_", "");
      return item;
    });
  }

  if (ctx.kind === "acl-criterion") {
    const criteria = [
      ...groupItems(data, "acl_criteria").map((g) => g.name),
      ...groupItems(data, "sample_fetches").map((g) => g.name),
    ];
    return filterByPrefix(criteria, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.detail = "ACL criterion";
      return item;
    });
  }

  if (ctx.kind === "directive-argument") {
    const sectionKeywords = keywordsForSection(data, ctx.line.section);
    const allowed = new Set(sectionKeywords.map((kw) => kw.name.toLowerCase()));
    const directive = resolveDirective(ctx.line, allowed, {
      modifierPrefixes: modifierPrefixSet(schema),
    });
    if (!directive.matched) {
      return [];
    }
    const kw = sectionKeywords.find((k) => k.name.toLowerCase() === directive.keyword.toLowerCase());
    const schemaKw = getKeywordFromSchema(schema, directive.keyword);
    const pos = argumentPosition(ctx.tokenIndex, directive.end);
    const values = completionValuesForPosition(
      schemaKw,
      kw,
      pos,
      ctx.line,
      directive.end,
      directive.keyword
    );
    return filterByPrefix(
      values.map((v) => v.name),
      partial
    ).map((name) => {
      const value = values.find((v) => v.name === name);
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      item.detail = kw?.name ?? "argument";
      if (value?.description) {
        item.documentation = markdownDoc(value.description, kw?.docsUrl);
      }
      return item;
    });
  }

  const section = ctx.line.section;
  const keywords = keywordsForSection(data, section);
  const existing = new Set(ctx.line.tokens.map((t) => t.text.toLowerCase()));

  return keywords
    .filter((kw) => {
      if (ctx.tokenIndex === 0) {
        return kw.name.toLowerCase().startsWith(partial.toLowerCase());
      }
      return false;
    })
    .filter((kw) => !existing.has(kw.name.toLowerCase()) || ctx.tokenIndex === 0)
    .map((kw) => {
      const item = new vscode.CompletionItem(kw.name, vscode.CompletionItemKind.Keyword);
      item.detail =
        kw.signatures.length > 1 ? `${kw.signatures.length} forms` : kw.signatures[0] ?? kw.name;
      const sigList =
        kw.signatures.length > 1
          ? kw.signatures.map((s) => `- \`${s}\``).join("\n")
          : "";
      const doc = sigList ? `${kw.description}\n\n${sigList}` : kw.description;
      item.documentation = markdownDoc(doc, kw.docsUrl);
      return item;
    });
}
