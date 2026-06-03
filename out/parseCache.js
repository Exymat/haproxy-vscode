"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getParsedDocument = getParsedDocument;
const parser_1 = require("./parser");
const cache = new WeakMap();
function getParsedDocument(document) {
    const hit = cache.get(document);
    if (hit && hit.version === document.version) {
        return hit.parsed;
    }
    const parsed = (0, parser_1.parseDocument)(document);
    cache.set(document, { version: document.version, parsed });
    return parsed;
}
//# sourceMappingURL=parseCache.js.map