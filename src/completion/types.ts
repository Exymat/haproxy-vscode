import * as vscode from "vscode";

import { DocumentContext } from "../parser/documentContext";
import { HaproxyLanguageData } from "../language/languageData";
import { HaproxySchema } from "../schema/types";

export interface CompletionContext {
  document: vscode.TextDocument;
  position: vscode.Position;
  data: HaproxyLanguageData;
  schema: HaproxySchema;
  ctx: DocumentContext;
  partial: string;
}

export type CompletionHandler = (cc: CompletionContext) => vscode.CompletionItem[] | null;
