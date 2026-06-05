import { HaproxySchema, SampleFunction } from "./schema";

const DIAG_SOURCE = "haproxy";

export type SampleDiagCode =
  | "sample-missing-fetch"
  | "sample-unknown-fetch"
  | "sample-fetch-args"
  | "sample-unknown-converter"
  | "sample-converter-args"
  | "sample-converter-cast"
  | "sample-syntax";

export interface SampleDiagnostic {
  start: number;
  end: number;
  message: string;
  code: SampleDiagCode;
  source: typeof DIAG_SOURCE;
}

export interface ExpressionSpan {
  text: string;
  /** Column of the first character inside `%[` or `{`. */
  start: number;
}

const ID_RE = /[a-zA-Z0-9_.-]/;

/** Mirrors sample_casts[][] in src/sample.c (non-null = cast possible). */
const CAN_CAST: boolean[][] = [
  /* to:     ANY  SAME BOOL SINT ADDR IPV4 IPV6  STR  BIN METH */
  /* ANY */ [true, false, true, true, true, true, true, true, true, true],
  /* SAME */ [false, false, false, false, false, false, false, false, false, false],
  /* BOOL */ [true, false, true, true, false, false, false, true, true, false],
  /* SINT */ [true, false, true, true, true, true, true, true, true, false],
  /* ADDR */ [true, false, false, false, true, true, true, true, true, false],
  /* IPV4 */ [true, false, false, true, true, true, true, true, true, false],
  /* IPV6 */ [true, false, false, false, true, true, true, true, true, false],
  /* STR */ [true, false, true, true, true, true, true, true, false, true],
  /* BIN */ [true, false, false, false, false, false, false, true, true, true],
  /* METH */ [true, false, false, false, false, false, false, true, true, true],
];

const TYPE_INDEX: Record<string, number> = {
  any: 0,
  same: 1,
  bool: 2,
  sint: 3,
  addr: 4,
  ipv4: 5,
  ipv6: 6,
  str: 7,
  bin: 8,
  meth: 9,
};

const FETCH_MIN_ARGS: Record<string, number> = {
  payload_lv: 2,
};

const CONV_MIN_ARGS: Record<string, number> = {
  ipmask: 1,
  map: 1,
  map_str: 1,
  map_beg: 1,
  map_end: 1,
  map_sub: 1,
  map_dir: 1,
};

const INTEGER_ARG = /^(?:integer|signed integer|unsigned integer)$/i;
const MSK4_ARG = /^ipv4 mask$/i;
const MSK6_ARG = /^ipv6 mask$/i;

function typeIndex(type: string): number {
  return TYPE_INDEX[type.toLowerCase()] ?? -1;
}

function canCast(fromType: string, toType: string): boolean {
  const to = typeIndex(toType);
  if (to < 0 || toType === "" || toType === "any") {
    return true;
  }
  const from = typeIndex(fromType);
  if (from < 0) {
    return true;
  }
  return CAN_CAST[from]?.[to] ?? false;
}

function resolveOutType(prev: string, conv: SampleFunction): string {
  const out = conv.out_type?.toLowerCase() ?? "";
  const inn = conv.in_type?.toLowerCase() ?? "";
  if (out && out !== "same") {
    return out;
  }
  if (inn && canCast(prev, inn) && inn !== "same") {
    return inn;
  }
  return prev;
}

export function extractExpressionSpans(lineText: string): ExpressionSpan[] {
  const spans: ExpressionSpan[] = [];
  let idx = 0;
  while (idx < lineText.length) {
    const pct = lineText.indexOf("%[", idx);
    if (pct < 0) {
      break;
    }
    const start = pct + 2;
    const end = lineText.indexOf("]", start);
    if (end < 0) {
      spans.push({ text: lineText.slice(start), start });
      break;
    }
    spans.push({ text: lineText.slice(start, end), start });
    idx = end + 1;
  }

  // ACL conditions use { ... }; only %[ ... ] are sample expressions (see configuration.txt §7).
  return spans;
}

function isIdChar(ch: string): boolean {
  return ch.length === 1 && ID_RE.test(ch);
}

function skipSpace(text: string, pos: number): number {
  while (pos < text.length && /\s/.test(text[pos])) {
    pos++;
  }
  return pos;
}

function readIdentifier(text: string, pos: number): { name: string; end: number } {
  pos = skipSpace(text, pos);
  let end = pos;
  while (end < text.length && isIdChar(text[end])) {
    end++;
  }
  return { name: text.slice(pos, end), end };
}

interface ParsedArgList {
  args: { text: string; start: number; end: number }[];
  end: number;
  hadParens: boolean;
  error?: SampleDiagnostic;
}

function parseOneArg(
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
      error: issue(start, pos, "unclosed quote in argument", "sample-syntax"),
    };
  }
  return { arg: out, start, end: pos };
}

function parseArgList(
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
      const expected = argTypes[0] ?? "argument";
      return {
        args: [],
        end: pos,
        hadParens: false,
        error: issue(
          spanStart + pos,
          spanStart + pos + 1,
          `expected type '${expected}' at position 1, but got nothing`,
          missingCode,
        ),
      };
    }
    return { args: [], end: pos, hadParens: false };
  }

  const open = pos;
  pos++;
  const args: { text: string; start: number; end: number }[] = [];
  pos = skipSpace(text, pos);
  if (pos < text.length && text[pos] === ")") {
    if (minArgs > 0) {
      const expected = argTypes[0] ?? "argument";
      return {
        args: [],
        end: pos + 1,
        hadParens: true,
        error: issue(
          spanStart + open + 1,
          spanStart + pos,
          `expected type '${expected}' at position 1, but got nothing`,
          missingCode,
        ),
      };
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
        error: issue(spanStart + open, spanStart + text.length, "expected ')'", "sample-syntax"),
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
        error: issue(spanStart + open, spanStart + text.length, "expected ')'", "sample-syntax"),
      };
    }
    if (text[pos] === ")") {
      if (index < minArgs) {
        const expected = argTypes[index] ?? "argument";
        return {
          args,
          end: pos + 1,
          hadParens: true,
          error: issue(
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

function validateArgValue(
  argType: string,
  text: string,
  start: number,
  end: number,
  position: number,
): SampleDiagnostic | undefined {
  const norm = argType.toLowerCase();
  if (!text.trim()) {
    return issue(
      start,
      end,
      `expected type '${argType}' at position ${position}, but got nothing`,
      "sample-fetch-args",
    );
  }
  if (INTEGER_ARG.test(norm)) {
    if (!/^-?\d+$/.test(text.trim())) {
      return issue(
        start,
        end,
        `failed to parse '${text}' as type '${norm.includes("signed") ? "integer" : "integer"}' at position ${position}`,
        "sample-fetch-args",
      );
    }
    return undefined;
  }
  if (MSK4_ARG.test(norm)) {
    if (!/^[\d.]+(?:\/\d+)?$/.test(text.trim())) {
      return issue(
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
      return issue(
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

function issue(
  start: number,
  end: number,
  message: string,
  code: SampleDiagCode,
): SampleDiagnostic {
  return { start, end: Math.max(end, start + 1), message, code, source: DIAG_SOURCE };
}

function sampleMinArgs(spec: SampleFunction, name: string, fallback = 0): number {
  if (spec.min_args !== undefined && spec.min_args !== null) {
    return spec.min_args;
  }
  return FETCH_MIN_ARGS[name] ?? fallback;
}

function sampleMaxArgs(spec: SampleFunction): number {
  if (spec.max_args !== undefined && spec.max_args !== null) {
    return spec.max_args;
  }
  return spec.args.length;
}

function validateFetchArgs(
  name: string,
  spec: SampleFunction,
  parsed: ParsedArgList,
  _spanStart: number,
): SampleDiagnostic | undefined {
  const maxArgs = sampleMaxArgs(spec);

  if (maxArgs === 0 && parsed.hadParens && parsed.args.length > 0) {
    const first = parsed.args[0];
    return issue(
      first.start,
      first.end,
      `fetch method '${name}' : expected ')' before '${first.text}'`,
      "sample-fetch-args",
    );
  }

  if (parsed.error) {
    return parsed.error;
  }

  if (name === "payload_lv" && parsed.args.length >= 2) {
    const lenArg = parsed.args[1];
    const lenVal = Number.parseInt(lenArg.text.trim(), 10);
    if (!Number.isNaN(lenVal) && lenVal === 0) {
      return issue(
        lenArg.start,
        lenArg.end,
        `invalid args in fetch method 'payload_lv' : payload length must be > 0`,
        "sample-fetch-args",
      );
    }
  }

  if (parsed.args.length > maxArgs && maxArgs > 0) {
    const extra = parsed.args[maxArgs];
    return issue(
      extra.start,
      extra.end,
      `fetch method '${name}' : unexpected argument`,
      "sample-fetch-args",
    );
  }

  return undefined;
}

function validateConverterArgs(
  name: string,
  spec: SampleFunction,
  parsed: ParsedArgList,
  _nameStart: number,
): SampleDiagnostic | undefined {
  const maxArgs = sampleMaxArgs(spec);

  if (maxArgs === 0 && parsed.hadParens && parsed.args.length > 0) {
    return issue(
      parsed.args[0].start,
      parsed.args[0].end,
      `converter '${name}' does not support any args`,
      "sample-converter-args",
    );
  }

  if (parsed.error) {
    return parsed.error;
  }

  if (parsed.args.length > maxArgs && maxArgs > 0) {
    const extra = parsed.args[maxArgs];
    return issue(
      extra.start,
      extra.end,
      `converter '${name}' : unexpected argument`,
      "sample-converter-args",
    );
  }

  return undefined;
}

function lookupSample(
  name: string,
  table: Record<string, SampleFunction>,
): SampleFunction | undefined {
  return table[name];
}

export function validateExpressionBody(
  body: string,
  spanStart: number,
  fetches: Record<string, SampleFunction>,
  converters: Record<string, SampleFunction>,
  fetchNames: Set<string>,
  convNames: Set<string>,
): SampleDiagnostic[] {
  const issues: SampleDiagnostic[] = [];
  let pos = 0;
  const id = readIdentifier(body, pos);
  pos = id.end;

  if (!id.name) {
    if (body.trimStart().startsWith("(")) {
      issues.push(issue(spanStart, spanStart + 1, "missing fetch method", "sample-missing-fetch"));
    }
    return issues;
  }

  const fetchSpec = lookupSample(id.name, fetches);
  if (!fetchSpec && !fetchNames.has(id.name)) {
    if (id.name.startsWith("wurfl-")) {
      return issues;
    }
    issues.push(
      issue(
        spanStart,
        spanStart + id.name.length,
        `unknown fetch method '${id.name}'`,
        "sample-unknown-fetch",
      ),
    );
    return issues;
  }

  const spec = fetchSpec ?? { name: id.name, args: [], out_type: "any" };
  const parsedFetch = parseArgList(
    body,
    pos,
    spanStart,
    spec.args,
    sampleMinArgs(spec, id.name, 0),
  );
  const fetchArgIssue = validateFetchArgs(id.name, spec, parsedFetch, spanStart);
  if (fetchArgIssue) {
    issues.push(fetchArgIssue);
    return issues;
  }
  pos = parsedFetch.end;

  let sampleType = spec.out_type || "any";
  let lastConv = "";

  while (true) {
    pos = skipSpace(body, pos);
    if (pos >= body.length) {
      break;
    }
    if (body[pos] === ")") {
      issues.push(
        issue(
          spanStart + pos,
          spanStart + pos + 1,
          lastConv
            ? `missing comma after converter '${lastConv}'`
            : "missing comma after fetch keyword",
          "sample-syntax",
        ),
      );
      return issues;
    }
    if (body[pos] !== ",") {
      break;
    }
    pos++;
    pos = skipSpace(body, pos);
    const convId = readIdentifier(body, pos);
    if (!convId.name) {
      break;
    }
    pos = convId.end;
    lastConv = convId.name;

    const convSpec = lookupSample(convId.name, converters);
    if (!convSpec && !convNames.has(convId.name)) {
      issues.push(
        issue(
          spanStart + (convId.end - convId.name.length),
          spanStart + convId.end,
          `unknown converter '${convId.name}'`,
          "sample-unknown-converter",
        ),
      );
      return issues;
    }

    const cspec = convSpec ?? { name: convId.name, args: [], in_type: "any", out_type: "any" };
    const inType = cspec.in_type || "any";
    if (!canCast(sampleType, inType)) {
      issues.push(
        issue(
          spanStart + (convId.end - convId.name.length),
          spanStart + convId.end,
          `converter '${convId.name}' cannot be applied`,
          "sample-converter-cast",
        ),
      );
      return issues;
    }

    const convStart = spanStart + (convId.end - convId.name.length);
    const parsedConv = parseArgList(
      body,
      pos,
      spanStart,
      cspec.args,
      CONV_MIN_ARGS[convId.name] ?? 0,
      "sample-converter-args",
    );
    const convArgIssue = validateConverterArgs(convId.name, cspec, parsedConv, convStart);
    if (convArgIssue) {
      issues.push(convArgIssue);
      return issues;
    }
    pos = parsedConv.end;
    sampleType = resolveOutType(sampleType, cspec);
  }

  pos = skipSpace(body, pos);
  if (pos < body.length) {
    issues.push(
      issue(
        spanStart + pos,
        spanStart + Math.min(pos + 8, body.length),
        `unexpected token '${body.slice(pos, pos + 8)}'`,
        "sample-syntax",
      ),
    );
  }

  return issues;
}

export function validateSampleExpressions(
  lineText: string,
  schema: HaproxySchema,
): SampleDiagnostic[] {
  const fetches = schema.sample_fetches ?? {};
  const converters = schema.sample_converters ?? {};
  const fetchNames = new Set(Object.keys(fetches));
  const convNames = new Set(Object.keys(converters));
  for (const name of schema.keyword_groups.sample_fetches ?? []) {
    fetchNames.add(name);
  }
  for (const name of schema.keyword_groups.sample_converters ?? []) {
    convNames.add(name);
  }

  const issues: SampleDiagnostic[] = [];
  for (const span of extractExpressionSpans(lineText)) {
    issues.push(
      ...validateExpressionBody(span.text, span.start, fetches, converters, fetchNames, convNames),
    );
  }
  return issues;
}
