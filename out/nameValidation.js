"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findInvalidNameChar = findInvalidNameChar;
exports.looksLikeListenAddress = looksLikeListenAddress;
/** Matches HAProxy invalid_char() in src/tools.c */
function findInvalidNameChar(name) {
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
function looksLikeListenAddress(token) {
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
//# sourceMappingURL=nameValidation.js.map