import * as vscode from "vscode";

import { getDocumentContext } from "../parser/documentContext";
import { AnalyzedLine } from "../parser/lineAnalysis";
import { LineSemanticContext } from "../parser/lineSemanticContext";
import { HaproxyLanguageData } from "../language/languageData";
import { HaproxySchema } from "../schema/types";

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
  maxSymbolLines?: number;
}
