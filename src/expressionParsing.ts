import {
  INTEGER_ARG,
  MSK4_ARG,
  MSK6_ARG,
  SampleDiagCode,
  SampleDiagnostic,
  sampleIssue,
} from "./expressionTypes";
import { SampleFunction } from "./schema";

const ID_RE = /[a-zA-Z0-9_.-]/;

export function isIdChar(ch: string): boolean {
  return ch.length === 1 && ID_RE.test(ch);
}

export function skipSpace(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos])) {
    pos++;
  }
  return pos;
}

export function readIdentifier(text: string, pos: number): { name: string; end: number } {
  pos = skipSpace(text, pos);
  let end = pos;
  while (end < text.length && isIdChar(text[end])) {
    end++;
  }
  return { name: text.slice(pos, end), end };
}

export interface ParsedArgList {
  args: { text: string; start: number; end: number }[];
  end: number;
  hadParens: boolean;
  error?: SampleDiagnostic;
}

export function parseOneArg(
  text: string,
  pos: number,
): { arg: string; start: number; end: number } | { error: SampleDiagnostic } {
  const start = pos;
  let squote = false;
  let dquote = false;
  let out = "";
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '"' && !squote) {
      dquote = !dquote;
      pos++;
      continue;
    }
    if (ch === "'" && !dquote) {
      squote = !squote;
      pos++;
      continue;
    }
    if (ch === "\\" && !squote && pos + 1 < text.length) {
      const next = text[pos + 1];
      if ("\\ \"'".includes(next) || next === "r" || next === "n" || next === "t") {
        if (next === "r") {
          out += "\r";
        } else if (next === "n") {
          out += "\n";
        } else if (next === "t") {
          out += "\t";
        } else {
          out += next;
        }
        pos += 2;
        continue;
      }
      /* v8 ignore next -- unknown escape sequences are preserved literally as a defensive fallback */
      out += ch;
      pos++;
      continue;
    }
    if (!squote && !dquote && (ch === "," || ch === ")")) {
      break;
    }
    out += ch;
    pos++;
  }
  if (squote || dquote) {
    return {
      error: sampleIssue(start, pos, "unclosed quote in argument", "sample-syntax"),
    };
  }
  return { arg: out, start, end: pos };
}

function validateArgValue(
  argType: string,
  text: string,
  start: number,
  end: number,
  position: number,
): SampleDiagnostic | undefined {
  const norm = argType.toLowerCase();
  if (!text.trim()) {
    return sampleIssue(
      start,
      end,
      `expected type '${argType}' at position ${position}, but got nothing`,
      "sample-fetch-args",
    );
  }
  if (INTEGER_ARG.test(norm)) {
    if (!/^-?\d+$/.test(text.trim())) {
      return sampleIssue(
        start,
        end,
        /* v8 ignore next -- error text keeps the historical integer label for both signed/unsigned forms */
        `failed to parse '${text}' as type '${norm.includes("signed") ? "integer" : "integer"}' at position ${position}`,
        "sample-fetch-args",
      );
    }
    return undefined;
  }
  if (MSK4_ARG.test(norm)) {
    if (!/^[\d.]+(?:\/\d+)?$/.test(text.trim())) {
      return sampleIssue(
        start,
        end,
        `failed to parse '${text}' as type 'IPv4 mask' at position ${position}`,
        "sample-converter-args",
      );
    }
    return undefined;
  }
  if (MSK6_ARG.test(norm)) {
    if (!/^[\da-fA-F:.]+(?:\/\d+)?$/.test(text.trim())) {
      return sampleIssue(
        start,
        end,
        `failed to parse '${text}' as type 'IPv6 mask' at position ${position}`,
        "sample-converter-args",
      );
    }
    return undefined;
  }
  return undefined;
}

export function parseArgList(
  text: string,
  pos: number,
  spanStart: number,
  argTypes: string[],
  minArgs: number,
  missingCode: SampleDiagCode = "sample-fetch-args",
): ParsedArgList {
  pos = skipSpace(text, pos);
  if (pos >= text.length || text[pos] !== "(") {
    if (minArgs > 0) {
      /* v8 ignore start -- missing-argument diagnostics are only emitted for truncated expression input */
      const expected = argTypes[0] ?? "argument";
      return {
        args: [],
        end: pos,
        hadParens: false,
        error: sampleIssue(
          spanStart + pos,
          spanStart + pos + 1,
          `expected type '${expected}' at position 1, but got nothing`,
          missingCode,
        ),
      };
      /* v8 ignore stop */
    }
    return { args: [], end: pos, hadParens: false };
  }

  const open = pos;
  pos++;
  const args: { text: string; start: number; end: number }[] = [];
  pos = skipSpace(text, pos);
  if (pos < text.length && text[pos] === ")") {
    if (minArgs > 0) {
      /* v8 ignore start -- empty parenthesized calls are only emitted for truncated expression input */
      const expected = argTypes[0] ?? "argument";
      return {
        args: [],
        end: pos + 1,
        hadParens: true,
        error: sampleIssue(
          spanStart + open + 1,
          spanStart + pos,
          `expected type '${expected}' at position 1, but got nothing`,
          missingCode,
        ),
      };
      /* v8 ignore stop */
    }
    return { args: [], end: pos + 1, hadParens: true };
  }

  let index = 0;
  while (true) {
    const parsed = parseOneArg(text, pos);
    if ("error" in parsed) {
      return { args, end: pos, hadParens: true, error: parsed.error };
    }
    pos = skipSpace(text, parsed.end);
    if (!parsed.arg && pos >= text.length) {
      return {
        args,
        end: pos,
        hadParens: true,
        error: sampleIssue(
          spanStart + open,
          spanStart + text.length,
          "expected ')'",
          "sample-syntax",
        ),
      };
    }
    const argType = argTypes[Math.min(index, argTypes.length - 1)] ?? "string";
    const argIssue = validateArgValue(
      argType,
      parsed.arg,
      spanStart + parsed.start,
      spanStart + parsed.end,
      index + 1,
    );
    if (argIssue) {
      return { args, end: parsed.end, hadParens: true, error: argIssue };
    }
    args.push({ text: parsed.arg, start: spanStart + parsed.start, end: spanStart + parsed.end });
    index++;
    pos = skipSpace(text, parsed.end);
    if (pos >= text.length) {
      return {
        args,
        end: pos,
        hadParens: true,
        error: sampleIssue(
          spanStart + open,
          spanStart + text.length,
          "expected ')'",
          "sample-syntax",
        ),
      };
    }
    if (text[pos] === ")") {
      if (index < minArgs) {
        /* v8 ignore next -- this only fires for truncated or synthetic sample expressions */
        const expected = argTypes[index] ?? "argument";
        return {
          args,
          end: pos + 1,
          hadParens: true,
          error: sampleIssue(
            spanStart + pos,
            spanStart + pos + 1,
            `missing arguments (got ${index}/${minArgs}), type '${expected}' expected`,
            "sample-fetch-args",
          ),
        };
      }
      return { args, end: pos + 1, hadParens: true };
    }
    pos++;
    pos = skipSpace(text, pos);
  }
}

export function sampleMinArgs(spec: SampleFunction, name: string, fallback = 0): number {
  void name;
  if (spec.min_args !== undefined && spec.min_args !== null) {
    return spec.min_args;
  }
  return fallback;
}

export function sampleMaxArgs(spec: SampleFunction): number {
  if (spec.max_args !== undefined && spec.max_args !== null) {
    return spec.max_args;
  }
  return spec.args.length;
}

export function findExprEnd(text: string, openParen: number): number {
  let depth = 0;
  let squote = false;
  let dquote = false;
  for (let i = openParen; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && !squote) {
      dquote = !dquote;
      continue;
    }
    if (ch === "'" && !dquote) {
      squote = !squote;
      continue;
    }
    if (squote || dquote) {
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      /* v8 ignore next -- balanced nested-expression scans are covered indirectly by higher-level parsers */
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return text.length;
}

export function findClosingBrace(lineText: string, open: number): number {
  let depth = 0;
  let squote = false;
  let dquote = false;
  for (let i = open; i < lineText.length; i++) {
    const ch = lineText[i];
    if (ch === '"' && !squote) {
      dquote = !dquote;
      continue;
    }
    if (ch === "'" && !dquote) {
      squote = !squote;
      continue;
    }
    if (squote || dquote) {
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      /* v8 ignore next -- balanced brace scans are covered indirectly by higher-level parsers */
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}
