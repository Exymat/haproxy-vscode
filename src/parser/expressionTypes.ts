import { DIAG_SOURCE } from "../diagnostics/diagnosticUtils";
import { HaproxySchema } from "../schema/types";
import { schemaSampleCasts, schemaSampleTypes } from "../schema/samples";

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

export const INTEGER_ARG = /^(?:integer|signed integer|unsigned integer)$/i;
export const MSK4_ARG = /^ipv4 mask$/i;
export const MSK6_ARG = /^ipv6 mask$/i;

function typeIndex(type: string, schema: HaproxySchema): number {
  return schemaSampleTypes(schema).indexOf(type.toLowerCase());
}

export function canCast(fromType: string, toType: string, schema: HaproxySchema): boolean {
  const to = typeIndex(toType, schema);
  if (to < 0 || toType === "" || toType === "any") {
    return true;
  }
  const from = typeIndex(fromType, schema);
  if (from < 0) {
    return true;
  }
  const casts = schemaSampleCasts(schema);
  return casts[from]?.[to] ?? false;
}

export function resolveOutType(
  prev: string,
  conv: { out_type?: string; in_type?: string },
  schema: HaproxySchema,
): string {
  const out = conv.out_type?.toLowerCase() ?? "";
  const inn = conv.in_type?.toLowerCase() ?? "";
  if (out && out !== "same") {
    return out;
  }
  if (inn && canCast(prev, inn, schema) && inn !== "same") {
    return inn;
  }
  return prev;
}

export function sampleIssue(
  start: number,
  end: number,
  message: string,
  code: SampleDiagCode,
): SampleDiagnostic {
  return { start, end: Math.max(end, start + 1), message, code, source: DIAG_SOURCE };
}
