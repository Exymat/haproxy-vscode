import * as vscode from "vscode";

import { parseDocument, ParsedLine, ParsedToken } from "./parser";
import { HaproxySchema } from "./schema";
import {
  actionTokenIndex,
  BIND_OPTIONS_WITH_VALUE,
  classifyArgumentToken,
  classifyValueToken,
  isWordToken,
  resolveDirectiveSpan,
  SERVER_OPTIONS_WITH_VALUE,
  tcpPhaseIndex,
} from "./tokenUtils";

export const tokenTypes = [
  "section",
  "sectionName",
  "keyword",
  "modifier",
  "option",
  "property",
  "function",
  "variable",
  "number",
  "string",
  "operator",
] as const;

export const tokenModifiers = ["declaration"] as const;

const legend = new vscode.SemanticTokensLegend(Array.from(tokenTypes), Array.from(tokenModifiers));

function sectionKeywordSet(schema: HaproxySchema, section: string | null): Set<string> {
  if (!section) {
    return new Set();
  }
  return new Set((schema.sections[section]?.keywords ?? []).map((k) => k.toLowerCase()));
}

function pushToken(
  builder: vscode.SemanticTokensBuilder,
  lineNo: number,
  token: ParsedToken,
  typeName: (typeof tokenTypes)[number],
  modifiers: number = 0
): void {
  const tokenType = tokenTypes.indexOf(typeName);
  if (tokenType < 0) {
    return;
  }
  builder.push(lineNo, token.start, token.end - token.start, tokenType, modifiers);
}

function markSpan(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  start: number,
  end: number,
  typeName: (typeof tokenTypes)[number]
): void {
  for (let i = start; i <= end && i < line.tokens.length; i += 1) {
    pushToken(builder, line.line, line.tokens[i], typeName);
  }
}

function highlightBindParams(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  fromIndex: number,
  bindOptions: Set<string>
): void {
  for (let i = fromIndex; i < line.tokens.length; i += 1) {
    const val = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
    if (!isWordToken(val)) {
      const valueType = classifyValueToken(line.tokens[i]);
      if (valueType) {
        pushToken(builder, line.line, line.tokens[i], valueType);
      }
      continue;
    }
    pushToken(builder, line.line, line.tokens[i], "property");
    if (BIND_OPTIONS_WITH_VALUE.has(val) && i + 1 < line.tokens.length) {
      const valueType = classifyValueToken(line.tokens[i + 1]);
      pushToken(builder, line.line, line.tokens[i + 1], valueType ?? "string");
      i += 1;
    }
  }
}

function highlightArguments(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  fromIndex: number,
  options: Set<string>,
  bindOptions: Set<string>,
  serverOptions: Set<string>
): void {
  for (let i = fromIndex; i < line.tokens.length; i += 1) {
    const val = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
    const argType = classifyArgumentToken(line.tokens[i], options, bindOptions, serverOptions);
    pushToken(builder, line.line, line.tokens[i], argType);
    if (
      (BIND_OPTIONS_WITH_VALUE.has(val) || SERVER_OPTIONS_WITH_VALUE.has(val)) &&
      i + 1 < line.tokens.length
    ) {
      const valueType = classifyArgumentToken(line.tokens[i + 1], options, bindOptions, serverOptions);
      pushToken(builder, line.line, line.tokens[i + 1], valueType);
      i += 1;
    }
  }
}

function highlightBindLine(builder: vscode.SemanticTokensBuilder, line: ParsedLine, bindOptions: Set<string>): void {
  if (line.tokens.length > 1) {
    pushToken(builder, line.line, line.tokens[1], "string");
  }
  highlightBindParams(builder, line, 2, bindOptions);
}

function highlightServerLine(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  options: Set<string>,
  bindOptions: Set<string>,
  serverOptions: Set<string>
): void {
  if (line.tokens.length > 1) {
    pushToken(builder, line.line, line.tokens[1], "variable");
  }
  if (line.tokens.length > 2) {
    pushToken(builder, line.line, line.tokens[2], "string");
  }
  highlightArguments(builder, line, 3, options, bindOptions, serverOptions);
}

function highlightOptionLine(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  optionIndex: number,
  options: Set<string>,
  bindOptions: Set<string>,
  serverOptions: Set<string>
): void {
  if (line.tokens[optionIndex]) {
    pushToken(builder, line.line, line.tokens[optionIndex], "option");
  }
  highlightArguments(builder, line, optionIndex + 1, options, bindOptions, serverOptions);
}

function highlightRuleLine(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  options: Set<string>,
  bindOptions: Set<string>,
  serverOptions: Set<string>
): void {
  const phaseIndex = tcpPhaseIndex(line);
  if (phaseIndex !== null && line.tokens[phaseIndex]) {
    pushToken(builder, line.line, line.tokens[phaseIndex], "keyword");
  }
  const actionIndex = actionTokenIndex(line);
  if (actionIndex !== null && line.tokens[actionIndex]) {
    pushToken(builder, line.line, line.tokens[actionIndex], "function");
  }
  const fromIndex = actionIndex !== null ? actionIndex + 1 : 1;
  highlightArguments(builder, line, fromIndex, options, bindOptions, serverOptions);
}

function highlightDirectiveLine(
  builder: vscode.SemanticTokensBuilder,
  line: ParsedLine,
  sectionKeywords: Set<string>,
  options: Set<string>,
  bindOptions: Set<string>,
  serverOptions: Set<string>
): void {
  const tokens = line.tokens;
  const t0 = tokens[0]?.text.toLowerCase() ?? "";
  const t1 = tokens[1]?.text.toLowerCase() ?? "";

  if (t0 === "no" || t0 === "default") {
    pushToken(builder, line.line, tokens[0], "modifier");
  }

  if ((t0 === "option" || (t0 === "no" && t1 === "option")) && tokens.length > 1) {
    const optionKeywordIndex = t0 === "option" ? 0 : 1;
    const optionValueIndex = t0 === "option" ? 1 : 2;
    pushToken(builder, line.line, tokens[optionKeywordIndex], "keyword");
    highlightOptionLine(builder, line, optionValueIndex, options, bindOptions, serverOptions);
    return;
  }

  if (t0 === "bind") {
    pushToken(builder, line.line, tokens[0], "keyword");
    highlightBindLine(builder, line, bindOptions);
    return;
  }

  if (t0 === "stats" && t1 === "socket") {
    markSpan(builder, line, 0, 1, "keyword");
    if (tokens[2]) {
      pushToken(builder, line.line, tokens[2], "string");
    }
    highlightBindParams(builder, line, 3, bindOptions);
    return;
  }

  if (t0 === "server") {
    pushToken(builder, line.line, tokens[0], "keyword");
    highlightServerLine(builder, line, options, bindOptions, serverOptions);
    return;
  }

  if (t0 === "http-request" || t0 === "http-response" || t0 === "tcp-request" || t0 === "tcp-response") {
    pushToken(builder, line.line, tokens[0], "keyword");
    highlightRuleLine(builder, line, options, bindOptions, serverOptions);
    return;
  }

  if (t0 === "acl") {
    pushToken(builder, line.line, tokens[0], "keyword");
    if (tokens[1]) {
      pushToken(builder, line.line, tokens[1], "variable");
    }
    if (tokens[2]) {
      pushToken(builder, line.line, tokens[2], "function");
    }
    highlightArguments(builder, line, 3, options, bindOptions, serverOptions);
    return;
  }

  const span = resolveDirectiveSpan(line, sectionKeywords);
  const keywordStart = t0 === "no" || t0 === "default" ? 1 : span.start;
  if (keywordStart <= span.end && span.end >= 0) {
    markSpan(builder, line, keywordStart, span.end, "keyword");
  }

  highlightArguments(builder, line, span.end + 1, options, bindOptions, serverOptions);
}

export function createSemanticTokensProvider(
  schema: HaproxySchema
): vscode.DocumentSemanticTokensProvider {
  return {
    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
      const parsed = parseDocument(document);
      const builder = new vscode.SemanticTokensBuilder(legend);
      const declaration = tokenModifiers.indexOf("declaration");

      const options = new Set((schema.keyword_groups.options ?? []).map((v) => v.toLowerCase()));
      const bindOptions = new Set((schema.keyword_groups.bind_options ?? []).map((v) => v.toLowerCase()));
      const serverOptions = new Set((schema.keyword_groups.server_options ?? []).map((v) => v.toLowerCase()));

      for (const line of parsed) {
        if (line.tokens.length === 0) {
          continue;
        }

        if (line.isSectionHeader) {
          pushToken(builder, line.line, line.tokens[0], "section", declaration);
          for (let i = 1; i < line.tokens.length; i += 1) {
            pushToken(builder, line.line, line.tokens[i], "sectionName");
          }
          continue;
        }

        if (line.tokens[0].text.startsWith(".")) {
          for (const token of line.tokens) {
            pushToken(builder, line.line, token, "keyword");
          }
          continue;
        }

        highlightDirectiveLine(
          builder,
          line,
          sectionKeywordSet(schema, line.section),
          options,
          bindOptions,
          serverOptions
        );
      }

      return builder.build();
    },
  };
}

export function semanticTokensLegend(): vscode.SemanticTokensLegend {
  return legend;
}
