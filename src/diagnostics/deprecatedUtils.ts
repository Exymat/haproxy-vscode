import { ParsedLine } from "../parser";

export function documentUsesExposeDeprecatedDirectives(parsed: ParsedLine[]): boolean {
  for (const line of parsed) {
    if (line.section !== "global" || line.tokens.length === 0) {
      continue;
    }
    if (line.tokens[0].text.toLowerCase() === "expose-deprecated-directives") {
      return true;
    }
  }
  return false;
}
