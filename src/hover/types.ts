import * as vscode from "vscode";

import { getDocumentContext } from "../documentContext";
import { AnalyzedLine } from "../lineAnalysis";
import { LineSemanticContext } from "../lineSemanticContext";
import { HaproxyLanguageData } from "../languageData";
import { HaproxySchema } from "../schema";

type BaseDocumentContext = NonNullable<ReturnType<typeof getDocumentContext>>;
export type DocumentContextWithToken = BaseDocumentContext & {
  token: NonNullable<BaseDocumentContext["token"]>;
};

export interface HoverContext {
  document: vscode.TextDocument;
  position: vscode.Position;
  data: HaproxyLanguageData;
  schema: HaproxySchema;
  semantic: LineSemanticContext;
  ctx: DocumentContextWithToken;
  range: vscode.Range;
  cursorOffset: number;
  tokenLower: string;
  analyzed?: AnalyzedLine;
}
