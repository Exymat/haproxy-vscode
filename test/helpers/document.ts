export interface MockTextDocument {
  uri: string;
  version: number;
  lineCount: number;
  lineAt(lineNo: number): { text: string };
  getText(range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }): string;
  getWordRangeAtPosition?(
    position: { line: number; character: number },
    pattern?: RegExp,
  ):
    | {
        start: { line: number; character: number };
        end: { line: number; character: number };
      }
    | undefined;
}

export function createDocument(content: string, uri = "file:///test.cfg"): MockTextDocument {
  const lines = content.split(/\r?\n/);
  return {
    uri,
    version: 1,
    lineCount: lines.length,
    lineAt(lineNo: number) {
      return { text: lines[lineNo] ?? "" };
    },
    getText(range) {
      if (!range) {
        return content;
      }
      const line = lines[range.start.line] ?? "";
      return line.slice(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(position, _pattern?: RegExp) {
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
      };
    },
  };
}
