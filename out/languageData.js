"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearLanguageDataCache = clearLanguageDataCache;
exports.loadLanguageData = loadLanguageData;
exports.findKeywordByPrefix = findKeywordByPrefix;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const version_1 = require("./version");
const languageDataCache = new Map();
function clearLanguageDataCache() {
    languageDataCache.clear();
}
function loadLanguageData(context, version = version_1.DEFAULT_HAPROXY_VERSION) {
    const cached = languageDataCache.get(version);
    if (cached) {
        return cached;
    }
    const filePath = path.join(context.extensionPath, "schemas", `haproxy-${version}.language.json`);
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    languageDataCache.set(version, data);
    return data;
}
function findKeywordByPrefix(data, prefix) {
    const lower = prefix.toLowerCase();
    if (data.keywords[lower]) {
        return data.keywords[lower];
    }
    let best;
    for (const kw of Object.values(data.keywords)) {
        const name = kw.name.toLowerCase();
        if (lower.startsWith(name) && (!best || name.length > best.name.length)) {
            best = kw;
        }
    }
    return best;
}
//# sourceMappingURL=languageData.js.map