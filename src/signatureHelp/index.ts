/** Provides parameter hints for HAProxy directive signatures. */
import * as vscode from "vscode";

import { slotForPosition } from "../diagnostics/argumentSlotValidation";
import { HaproxyLanguageData } from "../language/languageData";
import { getLineSemanticContext, directiveArgumentPosition } from "../parser/lineSemanticContext";
import { HaproxySchema } from "../schema/types";

function parameterLabel(slot: { optional?: boolean; value_kind?: string }): string {
  const kind = slot.value_kind ?? "argument";
  const label = `<${kind}>`;
  return slot.optional ? `[${label}]` : label;
}

function buildParameters(
  schema: HaproxySchema,
  keyword: string,
  model: NonNullable<
    NonNullable<ReturnType<typeof getLineSemanticContext>>["resolvedSchemaKeyword"]
  >["argument_model"],
): vscode.ParameterInformation[] {
  if (!model) {
    return [];
  }
  return model.slots.map((slot, index) => {
    const schemaKw = schema.keywords[keyword.toLowerCase()];
    const param = schemaKw?.arguments?.[index];
    const doc = param?.parameter ?? param?.description;
    return new vscode.ParameterInformation(
      parameterLabel(slot),
      doc ? new vscode.MarkdownString(doc) : undefined,
    );
  });
}

export function provideSignatureHelp(
  document: vscode.TextDocument,
  position: vscode.Position,
  schema: HaproxySchema,
  data: HaproxyLanguageData,
  maxLines: number,
): vscode.SignatureHelp | null {
  if (document.lineCount > maxLines) {
    return null;
  }

  const semantic = getLineSemanticContext(document, position, schema, data);
  if (!semantic?.directive.matched) {
    return null;
  }

  const schemaKw = semantic.resolvedSchemaKeyword;
  const langKw = semantic.resolvedLanguageKeyword;
  const signatures = schemaKw?.signatures ?? langKw?.signatures ?? [];
  if (signatures.length === 0) {
    return null;
  }

  const signatureInfos = signatures.map((signature) => {
    const info = new vscode.SignatureInformation(signature);
    info.parameters = buildParameters(schema, semantic.directive.keyword, schemaKw?.argument_model);
    return info;
  });

  let activeParameter = 0;
  if (semantic.ctx.tokenIndex > semantic.directive.end) {
    activeParameter = directiveArgumentPosition(semantic);
    const model = schemaKw?.argument_model;
    if (model) {
      const slot = slotForPosition(model, activeParameter);
      if (!slot && !model.slots.at(-1)?.variadic) {
        activeParameter = Math.max(0, model.slots.length - 1);
      }
    }
  }

  return {
    signatures: signatureInfos,
    activeSignature: 0,
    activeParameter,
  };
}
