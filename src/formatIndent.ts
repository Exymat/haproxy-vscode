import { FormatOptions } from "./formatter";

/** Indent style for directives inside a section (section headers stay left-aligned). */
export type FormatIndent = "spaces-4" | "spaces-2" | "tab";

export function formatIndentToOptions(indent: FormatIndent): Pick<FormatOptions, "indentStyle" | "indentSize"> {
  switch (indent) {
    case "spaces-2":
      return { indentStyle: "spaces", indentSize: 2 };
    case "tab":
      return { indentStyle: "tab", indentSize: 4 };
    default:
      return { indentStyle: "spaces", indentSize: 4 };
  }
}

export function isFormatIndent(value: string): value is FormatIndent {
  return value === "spaces-4" || value === "spaces-2" || value === "tab";
}

/** Map legacy haproxy.format.indentStyle / indentSize settings to FormatIndent. */
export function legacyFormatIndent(style: string, size: number): FormatIndent {
  if (style === "tab") {
    return "tab";
  }
  return size <= 2 ? "spaces-2" : "spaces-4";
}

export const FORMAT_INDENT_LABELS: Record<FormatIndent, string> = {
  "spaces-4": "4 spaces (recommended)",
  "spaces-2": "2 spaces",
  tab: "Tab (not recommended)",
};

export const FORMAT_INDENT_TAB_WARNING =
  "Tabs are convenient for indent but copy-paste poorly. HAProxy documentation recommends spaces (2–4) instead.";
