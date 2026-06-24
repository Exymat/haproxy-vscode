import type { Position, Range, TextDocument, TextLine } from "vscode";

export type MockTextDocument = TextDocument;

interface DocumentState {
  content: string;
  lines: string[];
  lineOffsets: number[];
  endOffset: number;
}

interface EditableMockTextDocument extends MockTextDocument {
  __setContent?(content: string): void;
}

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
  };
}

export function createDocument(content: string, uri = "file:///test.cfg"): MockTextDocument {
  const buildState = (nextContent: string): DocumentState => {
    const lines = nextContent.split(/\r?\n/);
    const lineOffsets: number[] = [];
    let runningOffset = 0;
    for (const line of lines) {
      lineOffsets.push(runningOffset);
      runningOffset += line.length + 1;
    }
    return {
      content: nextContent,
      lines,
      lineOffsets,
      endOffset: Math.max(0, runningOffset - 1),
    };
  };
  let state = buildState(content);

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
    get lineCount() {
      return state.lines.length;
    },
    lineAt(lineNo: number) {
      return createLine(state.lines[lineNo] ?? "", lineNo);
    },
    offsetAt(position: Position) {
      const line = Math.max(0, Math.min(position.line, state.lines.length - 1));
      const character = Math.max(0, position.character);
      return Math.min(state.endOffset, (state.lineOffsets[line] ?? 0) + character);
    },
    positionAt(offset: number) {
      const safeOffset = Math.max(0, Math.min(offset, state.endOffset));
      for (let i = 0; i < state.lines.length; i += 1) {
        const lineStart = state.lineOffsets[i] ?? 0;
        const lineEnd = lineStart + state.lines[i].length;
        if (safeOffset <= lineEnd || i === state.lines.length - 1) {
          return { line: i, character: safeOffset - lineStart } as Position;
        }
      }
      return {
        line: state.lines.length - 1,
        character: state.lines[state.lines.length - 1].length,
      } as Position;
    },
    getText(range?: Range) {
      if (!range) {
        return state.content;
      }
      const line = state.lines[range.start.line] ?? "";
      return line.slice(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(position: Position, _pattern?: RegExp) {
      const line = state.lines[position.line] ?? "";
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
    __setContent(nextContent: string) {
      state = buildState(nextContent);
      this.version += 1;
    },
  };
  return doc as unknown as MockTextDocument;
}

export function updateDocument(document: MockTextDocument, content: string): void {
  const editable = document as EditableMockTextDocument;
  if (!editable.__setContent) {
    throw new Error("document is not editable");
  }
  editable.__setContent(content);
}
