import { commentStartIndex, tokenizeLine } from "../parser";

/**
 * Layout rules follow HAProxy configuration.txt sections 2.1 and 2.2
 * (Configuration file format, Quoting and escaping). Those rules are
 * identical across supported versions 2.6, 2.8, 3.0, 3.2, and 3.4.
 */
export interface FormatOptions {
  indentStyle: "spaces" | "tab";
  /** Doc recommends 2-4 spaces when not using tabs. */
  indentSize: number;
  insertBlankLineBetweenSections: boolean;
  sectionHeaders: ReadonlySet<string>;
}

export const DEFAULT_FORMAT_OPTIONS: Omit<FormatOptions, "sectionHeaders"> = {
  indentStyle: "spaces",
  indentSize: 4,
  insertBlankLineBetweenSections: true,
};

export interface SplitLine {
  code: string;
  commentSuffix: string | null;
}

export function splitLineAtComment(line: string): SplitLine {
  const commentStart = commentStartIndex(line);
  if (commentStart >= 0) {
    return {
      code: line.slice(0, commentStart).trimEnd(),
      commentSuffix: line.slice(commentStart).trimStart(),
    };
  }

  return {
    code: line.trimEnd(),
    commentSuffix: null,
  };
}

function indentPrefix(options: FormatOptions): string {
  return options.indentStyle === "tab" ? "\t" : " ".repeat(options.indentSize);
}

function joinTokens(tokens: { text: string }[]): string {
  return tokens.map((token) => token.text).join(" ");
}

function appendComment(line: string, commentSuffix: string | null): string {
  if (!commentSuffix) {
    return line;
  }
  return `${line} ${commentSuffix}`;
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function lastNonEmptyLine(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].length > 0) {
      return lines[i];
    }
  }
  return undefined;
}

function stripTrailingBlankLines(lines: string[]): void {
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
}

export function formatConfig(text: string, options: FormatOptions): string {
  const sectionHeaders = options.sectionHeaders;
  const lineEnding = detectLineEnding(text);
  const hasTrailingNewline = text.endsWith("\n") || text.endsWith("\r\n");
  const indent = indentPrefix(options);
  const inputLines = text.split(/\r?\n/);
  if (hasTrailingNewline && inputLines.length > 0 && inputLines[inputLines.length - 1] === "") {
    inputLines.pop();
  }
  const outputLines: string[] = [];

  for (const rawLine of inputLines) {
    if (rawLine.trim().length === 0) {
      outputLines.push("");
      continue;
    }

    const { code, commentSuffix } = splitLineAtComment(rawLine);

    if (code.length === 0) {
      outputLines.push(commentSuffix as string);
      continue;
    }

    const tokens = tokenizeLine(code);

    if (sectionHeaders.has(tokens[0].text.toLowerCase())) {
      stripTrailingBlankLines(outputLines);
      if (options.insertBlankLineBetweenSections && outputLines.length > 0) {
        outputLines.push("");
      }
      outputLines.push(appendComment(joinTokens(tokens), commentSuffix));
      continue;
    }

    outputLines.push(appendComment(`${indent}${joinTokens(tokens)}`, commentSuffix));
  }

  if (lastNonEmptyLine(outputLines) !== undefined) {
    stripTrailingBlankLines(outputLines);
  }

  let formatted = outputLines.join(lineEnding);
  if (hasTrailingNewline) {
    formatted += lineEnding;
  }
  return formatted;
}
