/** Matches HAProxy invalid_char() in src/tools.c */
export function findInvalidNameChar(name: string): string | null {
  if (!name) {
    return "";
  }
  for (const ch of name) {
    if (!/[A-Za-z0-9]/.test(ch) && ch !== "." && ch !== ":" && ch !== "_" && ch !== "-") {
      return ch;
    }
  }
  return null;
}
