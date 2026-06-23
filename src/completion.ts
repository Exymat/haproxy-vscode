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
import { findStatementRule } from "./statementLayout";
import {
  resolveLineOptionSchemaKeyword,
  resolveLineOptionStartIndex,
  resolveNestedLineOptionSpan,
} from "./hover/lineOptions";
import { HaproxyLanguageData, LanguageExample } from "./languageData";
import { resolveLanguageKeyword } from "./keywordVariant";
import { languageDocMarkdown } from "./hover/markdown";
import { logFormatCompletionPrefix, logFormatContextAt } from "./logFormat";
import { HaproxySchema, modifierPrefixSet } from "./schema";

function markdownDoc(
  description: string,
  docsUrl?: string,
  examples?: LanguageExample[],
): vscode.MarkdownString {
  return languageDocMarkdown(description, docsUrl, examples);
}

function filterByPrefix(items: string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  if (!p) {
    return items;
  }
  return items.filter((item) => item.toLowerCase().startsWith(p));
}

function logFormatCompletionItems(
  data: HaproxyLanguageData,
  schema: HaproxySchema,
  formatText: string,
  localOffset: number,
): vscode.CompletionItem[] {
  const prefix = logFormatCompletionPrefix(formatText, localOffset) ?? "";
  const before = formatText.slice(0, localOffset);
  const inFlags = before.lastIndexOf("{") > before.lastIndexOf("}");

  if (inFlags) {
    const flags = schema.tokens.logformat_flags ?? [];
    return filterByPrefix(flags, prefix).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.EnumMember);
      item.detail = "log-format flag";
      const group = groupItems(data, "logformat_flags").find((g) => g.name === name);
      if (group?.description) {
        item.documentation = markdownDoc(group.description);
      }
      return item;
    });
  }

  const aliases = groupItems(data, "logformat_aliases");
  return aliases
    .filter((alias) => {
      const body = alias.name.replace(/^%/, "");
      return !prefix || body.toLowerCase().startsWith(prefix.toLowerCase());
    })
    .map((alias) => {
      const body = alias.name.replace(/^%/, "");
      const item = new vscode.CompletionItem(body, vscode.CompletionItemKind.Variable);
      item.detail = alias.name;
      item.insertText = body;
      if (alias.description) {
        item.documentation = markdownDoc(alias.description, alias.docsUrl);
      }
      return item;
    });
}

export function provideCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  data: HaproxyLanguageData,
  schema: HaproxySchema,
): vscode.CompletionItem[] {
  const ctx = getDocumentContext(document, position, schema);
  if (!ctx) {
    return [];
  }

  const lineText = document.lineAt(position.line).text;
  const fmtContext = logFormatContextAt(lineText, ctx.line.tokens, position.character, schema);
  if (fmtContext) {
    return logFormatCompletionItems(data, schema, fmtContext.region.text, fmtContext.localOffset);
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
    const optionItems = groupItems(data, "options");
    const optionsByName = new Map(optionItems.map((g) => [g.name, g]));
    const options = optionItems.map((g) => g.name);
    return filterByPrefix(options, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      const group = optionsByName.get(name);
      item.detail = "option";
      const optKeyword =
        data.keywords[`option ${name}`.toLowerCase()] ??
        data.keywords[`no option ${name}`.toLowerCase()];
      const resolved = optKeyword
        ? resolveLanguageKeyword(optKeyword, ctx.line.section)
        : undefined;
      if (
        resolved?.description ||
        group?.description ||
        resolved?.examples?.length ||
        group?.examples?.length
      ) {
        item.documentation = markdownDoc(
          resolved?.description ?? group?.description ?? "",
          resolved?.docsUrl ?? group?.docsUrl,
          resolved?.examples ?? group?.examples,
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
    const actionItems = groupItems(data, actionKind);
    const actionsByName = new Map(actionItems.map((g) => [g.name, g]));
    const actions = actionItems.map((g) => g.name);
    return filterByPrefix(actions, partial).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
      const group = actionsByName.get(name);
      item.detail = ctx.kind;
      if (group?.description || group?.examples?.length) {
        item.documentation = markdownDoc(group.description, group.docsUrl, group.examples);
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
    const kw = resolveLanguageKeyword(
      sectionKeywords.find((k) => k.name.toLowerCase() === directive.keyword.toLowerCase()),
      ctx.line.section,
    );
    const schemaKw = getKeywordFromSchema(schema, directive.keyword, ctx.line.section);
    const pos = argumentPosition(ctx.tokenIndex, directive.end);
    const values = completionValuesForPosition(
      schemaKw,
      kw,
      pos,
      ctx.line,
      directive.end,
      directive.keyword,
    );
    const valuesByName = new Map(values.map((v) => [v.name, v]));
    return filterByPrefix(
      values.map((v) => v.name),
      partial,
    ).map((name) => {
      const value = valuesByName.get(name);
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      item.detail = kw?.name ?? "argument";
      if (value?.description) {
        item.documentation = markdownDoc(value.description, kw?.docsUrl);
      }
      return item;
    });
  }

  if (ctx.kind === "bind" || ctx.kind === "server") {
    const lineOptionGroup = ctx.kind === "bind" ? "bind_options" : "server_options";
    const lineOptionRule = findStatementRule(schema, ctx.line);
    const lineOptionStart = resolveLineOptionStartIndex(ctx.line, lineOptionRule);
    if (lineOptionStart < 0 || ctx.tokenIndex < lineOptionStart) {
      return [];
    }

    const active = resolveNestedLineOptionSpan(schema, ctx, lineOptionGroup, lineOptionStart);
    if (active && ctx.tokenIndex > active.optionIndex) {
      const schemaKw = resolveLineOptionSchemaKeyword(
        schema,
        active.keyword,
        ctx.kind,
        ctx.line.section,
      );
      const langKw = resolveLanguageKeyword(data.keywords[active.keyword], ctx.line.section);
      const pos = argumentPosition(ctx.tokenIndex, active.optionIndex);
      const values = completionValuesForPosition(
        schemaKw,
        langKw,
        pos,
        ctx.line,
        active.optionIndex,
        active.keyword,
      );
      const valuesByName = new Map(values.map((v) => [v.name, v]));
      return filterByPrefix(
        values.map((v) => v.name),
        partial,
      ).map((name) => {
        const value = valuesByName.get(name);
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
        item.detail = active.keyword;
        if (value?.description) {
          item.documentation = markdownDoc(value.description);
        }
        return item;
      });
    }

    const optionItems = groupItems(data, lineOptionGroup);
    const optionsByName = new Map(optionItems.map((g) => [g.name, g]));
    return filterByPrefix(
      optionItems.map((g) => g.name),
      partial,
    ).map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
      const group = optionsByName.get(name);
      item.detail = ctx.kind;
      if (group?.description || group?.examples?.length) {
        item.documentation = markdownDoc(group.description, group.docsUrl, group.examples);
      }
      return item;
    });
  }

  const section = ctx.line.section;
  const keywords = keywordsForSection(data, section)
    .map((kw) => resolveLanguageKeyword(kw, section))
    .filter((kw): kw is NonNullable<typeof kw> => Boolean(kw));
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
        kw.signatures.length > 1 ? `${kw.signatures.length} forms` : (kw.signatures[0] ?? kw.name);
      const sigList =
        kw.signatures.length > 1 ? kw.signatures.map((s) => `- \`${s}\``).join("\n") : "";
      const doc = sigList ? `${kw.description}\n\n${sigList}` : kw.description;
      item.documentation = markdownDoc(doc, kw.docsUrl, kw.examples);
      return item;
    });
}
