import * as vscode from "vscode";

import { argumentTokenIndices } from "../directiveUtils";
import { LineDiagnosticMemo } from "../diagnosticContext";
import { ResolvedSchemaKeyword } from "../keywordVariant";
import { ParsedLine } from "../parser";
import { HaproxySchema, SchemaKeyword } from "../schema/types";
import { validationRecord } from "../schema/validation";

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

const HANDLERS_BY_RULE_KEY: Record<string, SpecialArgumentHandler> = {
  cookie: (ctx) => {
    if (ctx.match.keyword.toLowerCase() !== "cookie") {
      return null;
    }
    const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
    return cookieArgumentDiagnostics(
      ctx.line,
      ctx.match,
      argIndices,
      ctx.getConditionals(),
      ctx.schema,
    );
  },
  balance: (ctx) => {
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
  },
  "option mysql-check": (ctx) => {
    if (ctx.match.keyword.toLowerCase() !== "option mysql-check") {
      return null;
    }
    const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
    return mysqlCheckOptionDiagnostics(
      ctx.line,
      ctx.match,
      argIndices,
      ctx.getConditionals(),
      ctx.schema,
    );
  },
  "http-send-name-header": (ctx) => {
    if (ctx.match.keyword.toLowerCase() !== "http-send-name-header") {
      return null;
    }
    const argIndices = argumentTokenIndices(ctx.line, ctx.match.end);
    return httpSendNameHeaderDiagnostics(ctx.line, argIndices, ctx.schema.version, ctx.schema);
  },
};

function specialArgumentRuleKeys(schema: HaproxySchema): string[] {
  const rules = validationRecord(schema, "special_argument_rules");
  return Object.keys(rules);
}

/** Special-case argument validators tried before generic argument_model validation. */
export const SPECIAL_ARGUMENT_HANDLERS: SpecialArgumentHandler[] =
  Object.values(HANDLERS_BY_RULE_KEY);

export function runSpecialArgumentHandlers(
  ctx: SpecialArgumentContext,
): vscode.Diagnostic[] | null {
  for (const ruleKey of specialArgumentRuleKeys(ctx.schema)) {
    const handler = HANDLERS_BY_RULE_KEY[ruleKey];
    if (!handler) {
      continue;
    }
    const result = handler(ctx);
    if (result !== null) {
      return result;
    }
  }
  return null;
}
