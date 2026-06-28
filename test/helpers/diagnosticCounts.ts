import { formatDiagnosticCode } from "./diagnosticFormat";

export interface DiagnosticLike {
  code?: unknown;
  message: string;
  range: {
    start: {
      line: number;
    };
  };
  severity?: number;
}

function diagnosticCodeText(
  code: unknown,
): string | number | { value: string | number; target: unknown } | undefined {
  if (
    code === undefined ||
    typeof code === "string" ||
    typeof code === "number" ||
    (typeof code === "object" &&
      code !== null &&
      "value" in code &&
      (typeof (code as { value?: unknown }).value === "string" ||
        typeof (code as { value?: unknown }).value === "number"))
  ) {
    return code as string | number | { value: string | number; target: unknown } | undefined;
  }
  return JSON.stringify(code);
}

export function countDiagnosticsByCode(diags: DiagnosticLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diag of diags) {
    const code = formatDiagnosticCode(diagnosticCodeText(diag.code));
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

export function formatDiagnostics(diags: DiagnosticLike[]): string {
  return diags
    .map(
      (d) =>
        `  L${d.range.start.line + 1}: [${formatDiagnosticCode(diagnosticCodeText(d.code))}] ${d.message}`,
    )
    .join("\n");
}

export function assertDiagnosticCounts(
  diags: DiagnosticLike[],
  expected: Record<string, number>,
  label: string,
): void {
  const counts = countDiagnosticsByCode(diags);
  for (const [code, count] of Object.entries(expected)) {
    const actual = counts.get(code) ?? 0;
    if (actual !== count) {
      throw new Error(
        `${label}: expected ${count} '${code}' diagnostic(s), got ${actual}\n${formatDiagnostics(diags)}`,
      );
    }
  }
}
