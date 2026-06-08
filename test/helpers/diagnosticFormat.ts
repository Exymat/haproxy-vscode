export function formatDiagnosticCode(
  code: string | number | { value: string | number; target: unknown } | undefined,
): string {
  if (code === undefined) {
    return "unknown";
  }
  if (typeof code === "object") {
    return String(code.value);
  }
  return String(code);
}
