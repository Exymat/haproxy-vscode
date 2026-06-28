import type { Position } from "vscode";

export function lineAt(content: string, lineNo: number): string {
  return content.split("\n")[lineNo] ?? "";
}

export function cursorAtLineEnd(content: string, lineNo: number): Position {
  return { line: lineNo, character: lineAt(content, lineNo).length } as Position;
}

export function cursorAtToken(
  content: string,
  lineNo: number,
  token: string,
  offset = 0,
): Position {
  const line = lineAt(content, lineNo);
  const start = line.indexOf(token);
  if (start < 0) {
    throw new Error(`Token '${token}' not found on line ${lineNo}`);
  }
  return { line: lineNo, character: start + offset } as Position;
}
