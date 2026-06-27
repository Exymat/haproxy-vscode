import * as vscode from "vscode";

import { DocumentContext } from "../documentContext";
import { HaproxyLanguageData } from "../languageData";
import { HaproxySchema } from "../schema";

export interface CompletionContext {
  document: vscode.TextDocument;
  position: vscode.Position;
  data: HaproxyLanguageData;
  schema: HaproxySchema;
  ctx: DocumentContext;
  partial: string;
}

export type CompletionHandler = (cc: CompletionContext) => vscode.CompletionItem[] | null;
