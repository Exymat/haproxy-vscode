import * as vscode from "vscode";

import { argumentTokenIndices } from "../directiveUtils";
import { LineDiagnosticMemo } from "../diagnosticContext";
import { ResolvedSchemaKeyword } from "../keywordVariant";
import { ParsedLine } from "../parser";
import { HaproxySchema, SchemaKeyword } from "../schema";

import { balanceArgumentDiagnostics } from "./balance";
import { cookieArgumentDiagnostics } from "./cookie";
import { httpSendNameHeaderDiagnostics, mysqlCheckOptionDiagnostics } from "./specialKeywords";

export interface SpecialArgumentContext {
  line: ParsedLine;
  schema: HaproxySchema;
  match: { matched: boolean; end: number; keyword: string };
  memo: LineDiagnosticMemo;
  fullKeyword: SchemaKeyword | undefined;
  schemaKw: ResolvedSchemaKeyword | undefined;
  getConditionals: () => Set<string>;
}

export type SpecialArgumentHandler = (ctx: SpecialArgumentContext) => vscode.Diagnostic[] | null;

function handleCookie(ctx: SpecialArgumentContext): vscode.Diagnostic[] | null {
  if (ctx.match.keyword.toLowerCase() !== "cookie") {
    return null;
  }
  const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
  return cookieArgumentDiagnostics(ctx.line, ctx.match, argIndices, ctx.getConditionals());
}

function handleBalance(ctx: SpecialArgumentContext): vscode.Diagnostic[] | null {
  if (ctx.match.keyword.toLowerCase() !== "balance") {
    return null;
  }
  const model = ctx.schemaKw?.argument_model;
  if (!model || model.max_args === null || model.max_args === undefined) {
    return [];
  }
  const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
  return balanceArgumentDiagnostics(
    ctx.line,
    ctx.match,
    argIndices,
    model,
    ctx.schemaKw,
    ctx.schema,
    ctx.getConditionals(),
  );
}

function handleMysqlCheckOption(ctx: SpecialArgumentContext): vscode.Diagnostic[] | null {
  if (ctx.match.keyword.toLowerCase() !== "option mysql-check") {
    return null;
  }
  const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
  return mysqlCheckOptionDiagnostics(ctx.line, ctx.match, argIndices, ctx.getConditionals());
}

function handleHttpSendNameHeader(ctx: SpecialArgumentContext): vscode.Diagnostic[] | null {
  if (ctx.match.keyword.toLowerCase() !== "http-send-name-header") {
    return null;
  }
  const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
  return httpSendNameHeaderDiagnostics(ctx.line, argIndices, ctx.schema.version);
}

/** Special-case argument validators tried before generic argument_model validation. */
export const SPECIAL_ARGUMENT_HANDLERS: SpecialArgumentHandler[] = [
  handleCookie,
  handleBalance,
  handleMysqlCheckOption,
  handleHttpSendNameHeader,
];

export function runSpecialArgumentHandlers(
  ctx: SpecialArgumentContext,
): vscode.Diagnostic[] | null {
  for (const handler of SPECIAL_ARGUMENT_HANDLERS) {
    const result = handler(ctx);
    if (result !== null) {
      return result;
    }
  }
  return null;
}
