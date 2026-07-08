import { createDocument } from "../../helpers/document";
import { loadSchema } from "../../helpers/schema";
import type { Position, TextDocument } from "vscode";

export const schema = loadSchema("3.4");

export function pos(line: number, character: number) {
  return { line, character } as Position;
}

export function doc(content: string): TextDocument {
  return createDocument(content);
}
