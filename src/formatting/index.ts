/** Formats HAProxy configuration text according to indent and section layout options. */
import { commentStartIndex, ParsedToken, tokenizeLine } from "../parser";

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

export interface FormatLineRange {
  startLine: number;
  endLine: number;
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

/** Reconstructs code text preserving whitespace gaps from the source line. */
export function preserveTokenSpacing(sourceLine: string, tokens: ParsedToken[]): string {
  if (tokens.length === 0) {
    return "";
  }
  let result = sourceLine.slice(tokens[0].start, tokens[0].end);
  for (let i = 1; i < tokens.length; i += 1) {
    const previous = tokens[i - 1];
    const current = tokens[i];
    result += sourceLine.slice(previous.end, current.start);
    result += sourceLine.slice(current.start, current.end);
  }
  return result;
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

interface FormatLineContext {
  outputLines: string[];
  options: FormatOptions;
  sectionHeaders: ReadonlySet<string>;
  indent: string;
  preserveSpacing: boolean;
  rangeFormat: boolean;
}

function formatCodeLine(rawCode: string, context: FormatLineContext): string | null {
  const { code, commentSuffix } = splitLineAtComment(rawCode);
  if (code.length === 0) {
    return commentSuffix;
  }

  const tokens = tokenizeLine(code);
  const formattedTokens = context.preserveSpacing
    ? preserveTokenSpacing(code, tokens)
    : joinTokens(tokens);

  if (context.sectionHeaders.has(tokens[0].text.toLowerCase())) {
    if (!context.rangeFormat) {
      stripTrailingBlankLines(context.outputLines);
      if (context.options.insertBlankLineBetweenSections && context.outputLines.length > 0) {
        context.outputLines.push("");
      }
    }
    return appendComment(formattedTokens, commentSuffix);
  }

  return appendComment(`${context.indent}${formattedTokens}`, commentSuffix);
}

function formatLines(
  inputLines: string[],
  options: FormatOptions,
  preserveSpacing: boolean,
  lineRange?: FormatLineRange,
): string[] {
  const sectionHeaders = options.sectionHeaders;
  const indent = indentPrefix(options);
  const outputLines: string[] = [];
  const startLine = lineRange?.startLine ?? 0;
  const endLine = lineRange?.endLine ?? inputLines.length - 1;
  const context: FormatLineContext = {
    outputLines,
    options,
    sectionHeaders,
    indent,
    preserveSpacing,
    rangeFormat: lineRange !== undefined,
  };

  for (let lineNo = 0; lineNo < inputLines.length; lineNo += 1) {
    const rawLine = inputLines[lineNo];
    if (lineNo < startLine || lineNo > endLine) {
      outputLines.push(rawLine);
      continue;
    }

    if (rawLine.trim().length === 0) {
      outputLines.push("");
      continue;
    }

    const formatted = formatCodeLine(rawLine, context);
    outputLines.push(formatted ?? rawLine);
  }

  if (!lineRange && lastNonEmptyLine(outputLines) !== undefined) {
    stripTrailingBlankLines(outputLines);
  }

  return outputLines;
}

export function formatConfig(text: string, options: FormatOptions): string {
  const lineEnding = detectLineEnding(text);
  const hasTrailingNewline = text.endsWith("\n") || text.endsWith("\r\n");
  const inputLines = text.split(/\r?\n/);
  if (hasTrailingNewline && inputLines.length > 0 && inputLines[inputLines.length - 1] === "") {
    inputLines.pop();
  }

  const outputLines = formatLines(inputLines, options, false);
  let formatted = outputLines.join(lineEnding);
  if (hasTrailingNewline) {
    formatted += lineEnding;
  }
  return formatted;
}

export function formatConfigRange(
  text: string,
  range: FormatLineRange,
  options: FormatOptions,
): string {
  const lineEnding = detectLineEnding(text);
  const inputLines = text.split(/\r?\n/);
  const boundedRange = {
    startLine: Math.max(0, Math.min(range.startLine, inputLines.length - 1)),
    endLine: Math.max(0, Math.min(range.endLine, inputLines.length - 1)),
  };
  if (boundedRange.startLine > boundedRange.endLine || inputLines.length === 0) {
    return "";
  }

  const outputLines = formatLines(inputLines, options, true, boundedRange);
  return outputLines.slice(boundedRange.startLine, boundedRange.endLine + 1).join(lineEnding);
}
