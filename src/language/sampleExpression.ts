import { HaproxySchema, SampleFunction } from "../schema/types";
import { validationRecord } from "../schema/validation";
import { sampleExpressionNameSets } from "../schema/tokens";
import { canCast, resolveOutType, SampleDiagnostic, sampleIssue } from "../parser/expressionTypes";
import {
  parseArgList,
  readIdentifier,
  sampleMaxArgs,
  sampleMinArgs,
  skipSpace,
} from "../parser/expressionParsing";

export type { SampleDiagCode, SampleDiagnostic } from "../parser/expressionTypes";

export interface ExpressionSpan {
  text: string;
  /** Column of the first character inside `%[` or `{`. */
  start: number;
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

function validateFetchArgs(
  name: string,
  spec: SampleFunction,
  parsed: ReturnType<typeof parseArgList>,
  _spanStart: number,
): SampleDiagnostic | undefined {
  const maxArgs = sampleMaxArgs(spec);

  if (maxArgs === 0 && parsed.hadParens && parsed.args.length > 0) {
    const first = parsed.args[0];
    return sampleIssue(
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
      return sampleIssue(
        lenArg.start,
        lenArg.end,
        `invalid args in fetch method 'payload_lv' : payload length must be > 0`,
        "sample-fetch-args",
      );
    }
  }

  if (parsed.args.length > maxArgs && maxArgs > 0) {
    const extra = parsed.args[maxArgs];
    return sampleIssue(
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
  parsed: ReturnType<typeof parseArgList>,
  _nameStart: number,
): SampleDiagnostic | undefined {
  const maxArgs = sampleMaxArgs(spec);

  if (maxArgs === 0 && parsed.hadParens && parsed.args.length > 0) {
    return sampleIssue(
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
    return sampleIssue(
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
  return table[name] ?? table[name.toLowerCase()];
}

export function validateExpressionBody(
  body: string,
  spanStart: number,
  fetches: Record<string, SampleFunction>,
  converters: Record<string, SampleFunction>,
  fetchNames: Set<string>,
  convNames: Set<string>,
  schema: HaproxySchema,
): SampleDiagnostic[] {
  const issues: SampleDiagnostic[] = [];
  let pos = 0;
  const id = readIdentifier(body, pos);
  pos = id.end;

  if (!id.name) {
    if (body.trimStart().startsWith("(")) {
      issues.push(
        sampleIssue(spanStart, spanStart + 1, "missing fetch method", "sample-missing-fetch"),
      );
    }
    return issues;
  }

  const fetchSpec = lookupSample(id.name, fetches);
  if (!fetchSpec && !fetchNames.has(id.name.toLowerCase())) {
    if (id.name.startsWith("wurfl-")) {
      return issues;
    }
    issues.push(
      sampleIssue(
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
    Number(validationRecord(schema, "fetch_min_args")[id.name]) || sampleMinArgs(spec, id.name, 0),
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
        sampleIssue(
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
    if (!convSpec && !convNames.has(convId.name.toLowerCase())) {
      issues.push(
        sampleIssue(
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
    if (!canCast(sampleType, inType, schema)) {
      issues.push(
        sampleIssue(
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
      Number(validationRecord(schema, "converter_min_args")[convId.name]) || 0,
      "sample-converter-args",
    );
    const convArgIssue = validateConverterArgs(convId.name, cspec, parsedConv, convStart);
    if (convArgIssue) {
      issues.push(convArgIssue);
      return issues;
    }
    pos = parsedConv.end;
    sampleType = resolveOutType(sampleType, cspec, schema);
  }

  pos = skipSpace(body, pos);
  if (pos < body.length) {
    issues.push(
      sampleIssue(
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
  const { fetchNames, convNames } = sampleExpressionNameSets(schema);

  const issues: SampleDiagnostic[] = [];
  for (const span of extractExpressionSpans(lineText)) {
    issues.push(
      ...validateExpressionBody(
        span.text,
        span.start,
        fetches,
        converters,
        fetchNames,
        convNames,
        schema,
      ),
    );
  }
  return issues;
}
