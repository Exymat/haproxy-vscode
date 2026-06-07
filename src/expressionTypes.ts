import { DIAG_SOURCE } from "./diagnosticUtils";

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

export const FETCH_MIN_ARGS: Record<string, number> = {
  payload_lv: 2,
};

export const CONV_MIN_ARGS: Record<string, number> = {
  ipmask: 1,
  map: 1,
  map_str: 1,
  map_beg: 1,
  map_end: 1,
  map_sub: 1,
  map_dir: 1,
};

export const INTEGER_ARG = /^(?:integer|signed integer|unsigned integer)$/i;
export const MSK4_ARG = /^ipv4 mask$/i;
export const MSK6_ARG = /^ipv6 mask$/i;

function typeIndex(type: string): number {
  return TYPE_INDEX[type.toLowerCase()] ?? -1;
}

export function canCast(fromType: string, toType: string): boolean {
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

export function resolveOutType(
  prev: string,
  conv: { out_type?: string; in_type?: string },
): string {
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

export function sampleIssue(
  start: number,
  end: number,
  message: string,
  code: SampleDiagCode,
): SampleDiagnostic {
  return { start, end: Math.max(end, start + 1), message, code, source: DIAG_SOURCE };
}
