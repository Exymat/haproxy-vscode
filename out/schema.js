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
exports.clearSchemaCache = clearSchemaCache;
exports.buildPrefixSubcommands = buildPrefixSubcommands;
exports.sectionKeywordSet = sectionKeywordSet;
exports.loadSchema = loadSchema;
exports.sectionNames = sectionNames;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const version_1 = require("./version");
const schemaCache = new Map();
function clearSchemaCache() {
    schemaCache.clear();
}
function buildPrefixSubcommands(keywords, prefix) {
    const needle = `${prefix.toLowerCase()} `;
    const subs = new Set();
    for (const keyword of keywords) {
        const lower = keyword.toLowerCase();
        if (lower.startsWith(needle)) {
            subs.add(lower.slice(needle.length));
        }
    }
    return subs;
}
function sectionKeywordSet(schema, section) {
    if (!section) {
        return new Set();
    }
    const allowed = new Set((schema.sections[section]?.keywords ?? []).map((k) => k.toLowerCase()));
    for (const [name, keyword] of Object.entries(schema.keywords)) {
        if (keyword.sections.includes(section)) {
            allowed.add(name.toLowerCase());
        }
    }
    return allowed;
}
function loadSchema(context, version = version_1.DEFAULT_HAPROXY_VERSION) {
    const cached = schemaCache.get(version);
    if (cached) {
        return cached;
    }
    const schemaPath = path.join(context.extensionPath, "schemas", `haproxy-${version}.schema.json`);
    const raw = fs.readFileSync(schemaPath, "utf-8");
    const data = JSON.parse(raw);
    data.statement_rules = data.statement_rules ?? [];
    data.sample_fetches = data.sample_fetches ?? {};
    data.sample_converters = data.sample_converters ?? {};
    schemaCache.set(version, data);
    return data;
}
function sectionNames(schema) {
    return Object.keys(schema.sections).sort();
}
//# sourceMappingURL=schema.js.map