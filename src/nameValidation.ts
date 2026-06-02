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

export function looksLikeListenAddress(token: string): boolean {
  const t = token.trim();
  if (!t) {
    return false;
  }
  if (t.startsWith(":") || t.startsWith("*:") || t.startsWith("::")) {
    return true;
  }
  if (t.includes(":") && /^\d/.test(t) === false && !t.startsWith("/")) {
    return true;
  }
  return /^[\d.]+:\d/.test(t) || /^[\da-fA-F:]+:\d/.test(t);
}
