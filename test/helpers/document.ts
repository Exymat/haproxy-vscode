import type { Position, Range, TextDocument, TextLine } from "vscode";

export type MockTextDocument = TextDocument;

function createLine(text: string, lineNumber: number): TextLine {
  return {
    lineNumber,
    text,
    range: {
      start: { line: lineNumber, character: 0 },
      end: { line: lineNumber, character: text.length },
    } as Range,
    rangeIncludingLineBreak: {
      start: { line: lineNumber, character: 0 },
      end: { line: lineNumber, character: text.length + 1 },
    } as Range,
    firstNonWhitespaceCharacterIndex: text.search(/\S|$/),
    isEmptyOrWhitespace: text.trim().length === 0,
  } as TextLine;
}

export function createDocument(content: string, uri = "file:///test.cfg"): MockTextDocument {
  const lines = content.split(/\r?\n/);
  const lineOffsets: number[] = [];
  let runningOffset = 0;
  for (const line of lines) {
    lineOffsets.push(runningOffset);
    runningOffset += line.length + 1;
  }
  const endOffset = Math.max(0, runningOffset - 1);

  const doc = {
    uri: {
      toString: () => uri,
      fsPath: uri,
    },
    fileName: uri,
    isUntitled: false,
    languageId: "haproxy",
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    lineAt(lineNo: number) {
      return createLine(lines[lineNo] ?? "", lineNo);
    },
    offsetAt(position: Position) {
      const line = Math.max(0, Math.min(position.line, lines.length - 1));
      const character = Math.max(0, position.character);
      return Math.min(endOffset, (lineOffsets[line] ?? 0) + character);
    },
    positionAt(offset: number) {
      const safeOffset = Math.max(0, Math.min(offset, endOffset));
      for (let i = 0; i < lines.length; i += 1) {
        const lineStart = lineOffsets[i] ?? 0;
        const lineEnd = lineStart + lines[i].length;
        if (safeOffset <= lineEnd || i === lines.length - 1) {
          return { line: i, character: safeOffset - lineStart } as Position;
        }
      }
      return { line: lines.length - 1, character: lines[lines.length - 1].length } as Position;
    },
    getText(range?: Range) {
      if (!range) {
        return content;
      }
      const line = lines[range.start.line] ?? "";
      return line.slice(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(position: Position, _pattern?: RegExp) {
      const line = lines[position.line] ?? "";
      const before = line.slice(0, position.character);
      const match = before.match(/([a-zA-Z0-9_.-]+)$/);
      if (!match?.[1]) {
        return undefined;
      }
      const start = position.character - match[1].length;
      return {
        start: { line: position.line, character: start },
        end: { line: position.line, character: position.character },
      } as Range;
    },
    validateRange(range: Range) {
      return range;
    },
    validatePosition(position: Position) {
      return position;
    },
    save() {
      return Promise.resolve(true);
    },
  };
  return doc as unknown as MockTextDocument;
}
