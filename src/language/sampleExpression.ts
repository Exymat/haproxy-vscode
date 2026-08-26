/** Extracts and validates HAProxy sample expression spans. */
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

function resolveFetchHead(
  body: string,
  spanStart: number,
  fetches: Record<string, SampleFunction>,
  fetchNames: Set<string>,
):
  | { done: true; issues: SampleDiagnostic[] }
  | { done: false; pos: number; spec: SampleFunction; name: string } {
  const issues: SampleDiagnostic[] = [];
  const id = readIdentifier(body, 0);
  if (!id.name) {
    if (body.trimStart().startsWith("(")) {
      issues.push(
        sampleIssue(spanStart, spanStart + 1, "missing fetch method", "sample-missing-fetch"),
      );
    }
    return { done: true, issues };
  }

  const fetchSpec = lookupSample(id.name, fetches);
  if (!fetchSpec && !fetchNames.has(id.name.toLowerCase())) {
    if (id.name.startsWith("wurfl-")) {
      return { done: true, issues };
    }
    issues.push(
      sampleIssue(
        spanStart,
        spanStart + id.name.length,
        `unknown fetch method '${id.name}'`,
        "sample-unknown-fetch",
      ),
    );
    return { done: true, issues };
  }

  return {
    done: false,
    pos: id.end,
    spec: fetchSpec ?? { name: id.name, args: [], out_type: "any" },
    name: id.name,
  };
}

function converterSyntaxIssue(
  body: string,
  spanStart: number,
  pos: number,
  lastConv: string,
): SampleDiagnostic {
  return sampleIssue(
    spanStart + pos,
    spanStart + pos + 1,
    lastConv ? `missing comma after converter '${lastConv}'` : "missing comma after fetch keyword",
    "sample-syntax",
  );
}

function validateConverterStep(
  body: string,
  spanStart: number,
  convId: { name: string; end: number },
  pos: number,
  converters: Record<string, SampleFunction>,
  convNames: Set<string>,
  sampleType: string,
  schema: HaproxySchema,
):
  | { done: true; issue: SampleDiagnostic }
  | { done: false; pos: number; sampleType: string; lastConv: string } {
  const convSpec = lookupSample(convId.name, converters);
  if (!convSpec && !convNames.has(convId.name.toLowerCase())) {
    return {
      done: true,
      issue: sampleIssue(
        spanStart + (convId.end - convId.name.length),
        spanStart + convId.end,
        `unknown converter '${convId.name}'`,
        "sample-unknown-converter",
      ),
    };
  }

  const cspec = convSpec ?? { name: convId.name, args: [], in_type: "any", out_type: "any" };
  const inType = cspec.in_type || "any";
  if (!canCast(sampleType, inType, schema)) {
    return {
      done: true,
      issue: sampleIssue(
        spanStart + (convId.end - convId.name.length),
        spanStart + convId.end,
        `converter '${convId.name}' cannot be applied`,
        "sample-converter-cast",
      ),
    };
  }

  const parsedConv = parseArgList(
    body,
    pos,
    spanStart,
    cspec.args,
    Number(validationRecord(schema, "converter_min_args")[convId.name]) || 0,
    "sample-converter-args",
  );
  const convArgIssue = validateConverterArgs(convId.name, cspec, parsedConv, spanStart);
  if (convArgIssue) {
    return { done: true, issue: convArgIssue };
  }
  return {
    done: false,
    pos: parsedConv.end,
    sampleType: resolveOutType(sampleType, cspec, schema),
    lastConv: convId.name,
  };
}

function validateConverterChain(
  body: string,
  spanStart: number,
  startPos: number,
  sampleType: string,
  converters: Record<string, SampleFunction>,
  convNames: Set<string>,
  schema: HaproxySchema,
): SampleDiagnostic[] {
  const issues: SampleDiagnostic[] = [];
  let pos = startPos;
  let lastConv = "";
  let currentType = sampleType;

  while (true) {
    pos = skipSpace(body, pos);
    if (pos >= body.length) {
      break;
    }
    if (body[pos] === ")") {
      issues.push(converterSyntaxIssue(body, spanStart, pos, lastConv));
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

    const step = validateConverterStep(
      body,
      spanStart,
      convId,
      pos,
      converters,
      convNames,
      currentType,
      schema,
    );
    if (step.done) {
      issues.push(step.issue);
      return issues;
    }
    pos = step.pos;
    currentType = step.sampleType;
    lastConv = step.lastConv;
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

export function validateExpressionBody(
  body: string,
  spanStart: number,
  fetches: Record<string, SampleFunction>,
  converters: Record<string, SampleFunction>,
  fetchNames: Set<string>,
  convNames: Set<string>,
  schema: HaproxySchema,
): SampleDiagnostic[] {
  const head = resolveFetchHead(body, spanStart, fetches, fetchNames);
  if (head.done) {
    return head.issues;
  }

  const parsedFetch = parseArgList(
    body,
    head.pos,
    spanStart,
    head.spec.args,
    Number(validationRecord(schema, "fetch_min_args")[head.name]) ||
      sampleMinArgs(head.spec, head.name, 0),
  );
  const fetchArgIssue = validateFetchArgs(head.name, head.spec, parsedFetch, spanStart);
  if (fetchArgIssue) {
    return [fetchArgIssue];
  }

  return validateConverterChain(
    body,
    spanStart,
    parsedFetch.end,
    head.spec.out_type || "any",
    converters,
    convNames,
    schema,
  );
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
