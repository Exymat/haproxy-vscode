import { parseDocument } from "../../helpers/parse";
import { statementDiagnostics } from "../../../src/diagnostics/statementDiagnostics";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

export const bundle = loadSchemaBundle("3.4");

export function lineDiag(content: string, lineNo: number) {
  const doc = createDocument(content);
  const line = parseDocument(doc)[lineNo];
  return statementDiagnostics(line, bundle.schema);
}
