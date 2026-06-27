import { ParsedToken } from "./parser";
import { HaproxySchema, LogformatAlias, LogformatSlot } from "./schema";

export type { LogformatAlias, LogformatSlot };

export type LogFormatItemKind = "alias" | "flags" | "named" | "expression";

export interface LogFormatRegion {
  text: string;
  start: number;
  end: number;
}

export interface LogFormatLineMemo {
  regions: LogFormatRegion[];
}

export interface LogFormatItemSpan {
  start: number;
  end: number;
  kind: LogFormatItemKind;
  alias?: string;
  flags?: string[];
  named?: string;
}

export interface LogFormatDiagnostic {
  start: number;
  end: number;
  message: string;
  code: string;
}

const DEFAULT_FMT_STOP_TOKENS = new Set([
  "-m",
  "body",
  "body-lf",
  "comment",
  "content-type",
  "default-errorfiles",
  "errorfile",
  "errorfiles",
  "error-status",
  "file",
  "fhdr",
  "hdr",
  "if",
  "lf-file",
  "lf-string",
  "meth",
  "min-recv",
  "name",
  "name-lf",
  "ok-status",
  "on-error",
  "on-success",
  "send-binary-lf",
  "send-lf",
  "status",
  "status-code",
  "string",
  "string-lf",
  "tout-status",
  "unless",
  "uri",
  "uri-lf",
  "value",
  "value-lf",
  "ver",
]);

const FALLBACK_LINE_TAIL_DIRECTIVES = new Set([
  "log-format",
  "log-format-sd",
  "error-log-format",
  "unique-id-format",
  "set-var-fmt",
]);

const FALLBACK_PREFIX_SLOTS: LogformatSlot[] = [
  { kind: "prefix", prefix: "uri-lf", skip: 0 },
  { kind: "prefix", prefix: "body-lf", skip: 0 },
  { kind: "prefix", prefix: "on-success", skip: 0 },
  { kind: "prefix", prefix: "on-error", skip: 0 },
  { kind: "prefix", prefix: "string-lf", skip: 0 },
  { kind: "prefix", prefix: "name-lf", skip: 0 },
  { kind: "prefix", prefix: "value-lf", skip: 0 },
  { kind: "prefix", prefix: "lf-string", skip: 0 },
  { kind: "prefix", prefix: "lf-file", skip: 0 },
  { kind: "prefix", prefix: "send-lf", skip: 0 },
  { kind: "prefix", prefix: "hdr", skip: 1 },
  { kind: "prefix", prefix: "set-var-fmt", skip: 0 },
];

const logformatSlotCache = new WeakMap<HaproxySchema, LogformatSlot[]>();

function logformatSlots(schema: HaproxySchema): LogformatSlot[] {
  const cached = logformatSlotCache.get(schema);
  if (cached) {
    return cached;
  }

  const fromSchema = schema.logformat_slots ?? [];
  const slots =
    fromSchema.length > 0
      ? fromSchema
      : [
          ...[...FALLBACK_LINE_TAIL_DIRECTIVES].map(
            (directive): LogformatSlot => ({
              kind: "line_tail",
              directive,
              skip: directive === "set-var-fmt" ? 1 : 0,
            }),
          ),
          ...FALLBACK_PREFIX_SLOTS,
        ];
  logformatSlotCache.set(schema, slots);
  return slots;
}

function tokenKey(token: ParsedToken): string {
  return token.text.toLowerCase();
}

function isStopToken(text: string): boolean {
  const lower = text.toLowerCase();
  if (DEFAULT_FMT_STOP_TOKENS.has(lower)) {
    return true;
  }
  return lower.startsWith("set-var-fmt");
}

function regionFromTokens(
  lineText: string,
  tokens: ParsedToken[],
  startIndex: number,
): LogFormatRegion | null {
  if (startIndex >= tokens.length) {
    return null;
  }

  let endIndex = startIndex;
  while (endIndex < tokens.length && !isStopToken(tokens[endIndex].text)) {
    endIndex += 1;
  }
  if (endIndex === startIndex) {
    const token = tokens[startIndex];
    return { text: token.text, start: token.start, end: token.end };
  }

  const start = tokens[startIndex].start;
  const end = tokens[endIndex - 1].end;
  return { text: lineText.slice(start, end), start, end };
}

function lineTailRegion(
  lineText: string,
  tokens: ParsedToken[],
  directive: string,
  skip: number,
): LogFormatRegion | null {
  if (tokens.length === 0) {
    return null;
  }
  const first = tokenKey(tokens[0]);
  const needle = directive.toLowerCase();
  if (first !== needle && !first.startsWith(`${needle}(`)) {
    return null;
  }
  const startIndex = 1 + skip;
  return regionFromTokens(lineText, tokens, startIndex);
}

function prefixRegion(
  lineText: string,
  tokens: ParsedToken[],
  prefix: string,
  skip: number,
): LogFormatRegion[] {
  const regions: LogFormatRegion[] = [];
  const needle = prefix.toLowerCase();

  for (let i = 0; i < tokens.length; i += 1) {
    const text = tokens[i].text;
    const lower = text.toLowerCase();
    const matched =
      lower === needle || (needle === "set-var-fmt" && lower.startsWith("set-var-fmt"));
    if (!matched) {
      continue;
    }
    const region = regionFromTokens(lineText, tokens, i + 1 + skip);
    if (region) {
      regions.push(region);
    }
  }

  return regions;
}

export function extractLogFormatRegions(
  lineText: string,
  tokens: ParsedToken[],
  schema: HaproxySchema,
): LogFormatRegion[] {
  const regions: LogFormatRegion[] = [];
  const seen = new Set<string>();

  for (const slot of logformatSlots(schema)) {
    if (slot.kind === "line_tail" && slot.directive) {
      const region = lineTailRegion(lineText, tokens, slot.directive, slot.skip ?? 0);
      if (region) {
        const key = `${region.start}:${region.end}`;
        if (!seen.has(key)) {
          seen.add(key);
          regions.push(region);
        }
      }
      continue;
    }

    if (slot.kind === "prefix" && slot.prefix) {
      for (const region of prefixRegion(lineText, tokens, slot.prefix, slot.skip ?? 0)) {
        const key = `${region.start}:${region.end}`;
        if (!seen.has(key)) {
          seen.add(key);
          regions.push(region);
        }
      }
    }
  }

  return regions.sort((a, b) => a.start - b.start);
}

export function logFormatRegionAtOffset(
  lineText: string,
  tokens: ParsedToken[],
  offset: number,
  schema: HaproxySchema,
): LogFormatRegion | null {
  for (const region of extractLogFormatRegions(lineText, tokens, schema)) {
    if (offset >= region.start && offset <= region.end) {
      return region;
    }
  }
  return null;
}

function parseFlagBody(body: string, base: number): LogFormatFlagSpan[] {
  const spans: LogFormatFlagSpan[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === ",") {
      i += 1;
      continue;
    }
    if (ch !== "+" && ch !== "-") {
      i += 1;
      continue;
    }

    const sign = ch;
    const nameStart = i + 1;
    let j = nameStart;
    while (j < body.length && body[j] !== "," && body[j] !== "+" && body[j] !== "-") {
      j += 1;
    }
    const name = body.slice(nameStart, j).trim();
    if (name) {
      spans.push({
        flag: name,
        sign,
        start: base + nameStart,
        end: base + j,
      });
    }
    i = j;
  }
  return spans;
}

function parseFlagTokens(body: string): string[] {
  return parseFlagBody(body, 0).map((span) => span.flag);
}

export interface LogFormatFlagSpan {
  flag: string;
  sign: "+" | "-";
  start: number;
  end: number;
}

/** Flag token spans inside `{…}` blocks; `base` is added to returned start/end offsets. */
export function logFormatFlagSpans(text: string, base = 0): LogFormatFlagSpan[] {
  const spans: LogFormatFlagSpan[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const braceStart = text.indexOf("{", searchFrom);
    if (braceStart < 0) {
      break;
    }
    const close = text.indexOf("}", braceStart + 1);
    if (close < 0) {
      break;
    }

    const body = text.slice(braceStart + 1, close);
    spans.push(...parseFlagBody(body, base + braceStart + 1));
    searchFrom = close + 1;
  }

  return spans;
}

export function logFormatFlagAtOffset(text: string, offset: number): LogFormatFlagSpan | null {
  for (const span of logFormatFlagSpans(text)) {
    if (offset >= span.start && offset < span.end) {
      return span;
    }
  }
  return null;
}

export function extractLogFormatItems(text: string): LogFormatItemSpan[] {
  const spans: LogFormatItemSpan[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] !== "%") {
      i += 1;
      continue;
    }
    if (text[i + 1] === "%") {
      i += 2;
      continue;
    }

    const start = i;
    i += 1;
    let named: string | undefined;

    if (text[i] === "(") {
      const close = text.indexOf(")", i + 1);
      named = close >= 0 ? text.slice(i + 1, close) : text.slice(i + 1);
      i = close >= 0 ? close + 1 : text.length;
    }

    let flags: string[] = [];
    if (text[i] === "{") {
      const close = text.indexOf("}", i + 1);
      if (close >= 0) {
        flags = parseFlagTokens(text.slice(i + 1, close));
        i = close + 1;
      }
    }

    if (text[i] === "[") {
      const close = text.indexOf("]", i + 1);
      spans.push({
        start,
        end: close >= 0 ? close + 1 : text.length,
        kind: "expression",
        named,
        flags,
      });
      i = close >= 0 ? close + 1 : text.length;
      continue;
    }

    const aliasStart = i;
    while (i < text.length && /[A-Za-z0-9]/.test(text[i])) {
      i += 1;
    }
    const aliasBody = text.slice(aliasStart, i);
    if (aliasBody) {
      spans.push({
        start,
        end: i,
        kind: "alias",
        alias: `%${aliasBody}`,
        named,
        flags,
      });
      continue;
    }

    if (flags.length > 0 || named) {
      spans.push({
        start,
        end: i,
        kind: flags.length > 0 ? "flags" : "named",
        named,
        flags,
      });
    }
  }

  return spans;
}

export function logFormatItemAtOffset(text: string, offset: number): LogFormatItemSpan | null {
  for (const span of extractLogFormatItems(text)) {
    if (offset >= span.start && offset <= span.end) {
      return span;
    }
  }
  return null;
}

export function logformatAliasNames(schema: HaproxySchema): Set<string> {
  return new Set(Object.keys(schema.logformat_aliases ?? {}));
}

export function logformatFlagNames(schema: HaproxySchema): Set<string> {
  return new Set(schema.tokens.logformat_flags ?? []);
}

export function validateLogFormatItems(
  text: string,
  textStart: number,
  schema: HaproxySchema,
): LogFormatDiagnostic[] {
  const aliases = logformatAliasNames(schema);
  const flags = logformatFlagNames(schema);
  const issues: LogFormatDiagnostic[] = [];

  for (const item of extractLogFormatItems(text)) {
    const abs = (col: number) => textStart + col;
    if (item.kind === "alias" && item.alias && !aliases.has(item.alias)) {
      issues.push({
        start: abs(item.start),
        end: abs(item.end),
        message: `unknown log-format alias '${item.alias}'`,
        code: "logformat-unknown-alias",
      });
    }
    for (const flag of item.flags ?? []) {
      if (!flags.has(flag)) {
        issues.push({
          start: abs(item.start),
          end: abs(item.end),
          message: `unknown log-format flag '${flag}'`,
          code: "logformat-unknown-flag",
        });
      }
    }
  }

  return issues;
}

export function logFormatCompletionPrefix(text: string, offset: number): string | null {
  const before = text.slice(0, offset);
  const itemStart = before.lastIndexOf("%");
  if (itemStart < 0) {
    return null;
  }
  if (itemStart > 0 && before[itemStart - 1] === "%") {
    return null;
  }

  const tail = before.slice(itemStart + 1);
  if (tail.startsWith("[")) {
    return null;
  }
  if (tail.includes("{")) {
    const brace = tail.lastIndexOf("{");
    const flagTail = tail.slice(brace + 1);
    const comma = flagTail.lastIndexOf(",");
    const active =
      comma >= 0 ? flagTail.slice(comma + 1).replace(/^[+-]/, "") : flagTail.replace(/^[+-]/, "");
    return active;
  }

  const namedClose = tail.indexOf(")");
  const afterNamed = namedClose >= 0 ? tail.slice(namedClose + 1) : tail;
  const braceIdx = afterNamed.indexOf("{");
  const aliasTail = braceIdx >= 0 ? afterNamed.slice(afterNamed.indexOf("}") + 1) : afterNamed;
  return aliasTail;
}

export function validateLogFormatLine(
  lineText: string,
  tokens: ParsedToken[],
  schema: HaproxySchema,
  cachedRegions?: LogFormatRegion[],
): LogFormatDiagnostic[] {
  const issues: LogFormatDiagnostic[] = [];
  const regions = cachedRegions ?? extractLogFormatRegions(lineText, tokens, schema);
  for (const region of regions) {
    issues.push(...validateLogFormatItems(region.text, region.start, schema));
  }
  return issues;
}

export function logFormatContextAt(
  lineText: string,
  tokens: ParsedToken[],
  offset: number,
  schema: HaproxySchema,
): { region: LogFormatRegion; localOffset: number } | null {
  const region = logFormatRegionAtOffset(lineText, tokens, offset, schema);
  if (!region) {
    return null;
  }
  return { region, localOffset: offset - region.start };
}
