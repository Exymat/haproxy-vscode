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
exports.tokenModifiers = exports.tokenTypes = void 0;
exports.createSemanticTokensProvider = createSemanticTokensProvider;
exports.semanticTokensLegend = semanticTokensLegend;
const vscode = __importStar(require("vscode"));
const parseCache_1 = require("./parseCache");
const tokenUtils_1 = require("./tokenUtils");
exports.tokenTypes = [
    "section",
    "sectionName",
    "keyword",
    "modifier",
    "option",
    "property",
    "function",
    "variable",
    "number",
    "string",
    "operator",
];
exports.tokenModifiers = ["declaration"];
const legend = new vscode.SemanticTokensLegend(Array.from(exports.tokenTypes), Array.from(exports.tokenModifiers));
function sectionKeywordSet(schema, section) {
    if (!section) {
        return new Set();
    }
    return new Set((schema.sections[section]?.keywords ?? []).map((k) => k.toLowerCase()));
}
function pushToken(builder, lineNo, token, typeName, modifiers = 0) {
    const tokenType = exports.tokenTypes.indexOf(typeName);
    if (tokenType < 0) {
        return;
    }
    builder.push(lineNo, token.start, token.end - token.start, tokenType, modifiers);
}
function markSpan(builder, line, start, end, typeName) {
    for (let i = start; i <= end && i < line.tokens.length; i += 1) {
        pushToken(builder, line.line, line.tokens[i], typeName);
    }
}
function highlightBindParams(builder, line, fromIndex, bindOptions) {
    for (let i = fromIndex; i < line.tokens.length; i += 1) {
        const val = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
        if (!(0, tokenUtils_1.isWordToken)(val)) {
            const valueType = (0, tokenUtils_1.classifyValueToken)(line.tokens[i]);
            if (valueType) {
                pushToken(builder, line.line, line.tokens[i], valueType);
            }
            continue;
        }
        pushToken(builder, line.line, line.tokens[i], "property");
        if (tokenUtils_1.BIND_OPTIONS_WITH_VALUE.has(val) && i + 1 < line.tokens.length) {
            const valueType = (0, tokenUtils_1.classifyValueToken)(line.tokens[i + 1]);
            pushToken(builder, line.line, line.tokens[i + 1], valueType ?? "string");
            i += 1;
        }
    }
}
function highlightArguments(builder, line, fromIndex, options, bindOptions, serverOptions) {
    for (let i = fromIndex; i < line.tokens.length; i += 1) {
        const val = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
        const argType = (0, tokenUtils_1.classifyArgumentToken)(line.tokens[i], options, bindOptions, serverOptions);
        pushToken(builder, line.line, line.tokens[i], argType);
        if ((tokenUtils_1.BIND_OPTIONS_WITH_VALUE.has(val) || tokenUtils_1.SERVER_OPTIONS_WITH_VALUE.has(val)) &&
            i + 1 < line.tokens.length) {
            const valueType = (0, tokenUtils_1.classifyArgumentToken)(line.tokens[i + 1], options, bindOptions, serverOptions);
            pushToken(builder, line.line, line.tokens[i + 1], valueType);
            i += 1;
        }
    }
}
function highlightBindLine(builder, line, bindOptions) {
    if (line.tokens.length > 1) {
        pushToken(builder, line.line, line.tokens[1], "string");
    }
    highlightBindParams(builder, line, 2, bindOptions);
}
function highlightServerLine(builder, line, options, bindOptions, serverOptions) {
    if (line.tokens.length > 1) {
        pushToken(builder, line.line, line.tokens[1], "variable");
    }
    if (line.tokens.length > 2) {
        pushToken(builder, line.line, line.tokens[2], "string");
    }
    highlightArguments(builder, line, 3, options, bindOptions, serverOptions);
}
function highlightOptionLine(builder, line, optionIndex, options, bindOptions, serverOptions) {
    if (line.tokens[optionIndex]) {
        pushToken(builder, line.line, line.tokens[optionIndex], "option");
    }
    highlightArguments(builder, line, optionIndex + 1, options, bindOptions, serverOptions);
}
function highlightRuleLine(builder, line, options, bindOptions, serverOptions) {
    const phaseIndex = (0, tokenUtils_1.tcpPhaseIndex)(line);
    if (phaseIndex !== null && line.tokens[phaseIndex]) {
        pushToken(builder, line.line, line.tokens[phaseIndex], "keyword");
    }
    const actionIndex = (0, tokenUtils_1.actionTokenIndex)(line);
    if (actionIndex !== null && line.tokens[actionIndex]) {
        pushToken(builder, line.line, line.tokens[actionIndex], "function");
    }
    const fromIndex = actionIndex !== null ? actionIndex + 1 : 1;
    highlightArguments(builder, line, fromIndex, options, bindOptions, serverOptions);
}
function highlightDirectiveLine(builder, line, sectionKeywords, options, bindOptions, serverOptions) {
    const tokens = line.tokens;
    const t0 = tokens[0]?.text.toLowerCase() ?? "";
    const t1 = tokens[1]?.text.toLowerCase() ?? "";
    if (t0 === "no" || t0 === "default") {
        pushToken(builder, line.line, tokens[0], "modifier");
    }
    if ((t0 === "option" || (t0 === "no" && t1 === "option")) && tokens.length > 1) {
        const optionKeywordIndex = t0 === "option" ? 0 : 1;
        const optionValueIndex = t0 === "option" ? 1 : 2;
        pushToken(builder, line.line, tokens[optionKeywordIndex], "keyword");
        highlightOptionLine(builder, line, optionValueIndex, options, bindOptions, serverOptions);
        return;
    }
    if (t0 === "bind") {
        pushToken(builder, line.line, tokens[0], "keyword");
        highlightBindLine(builder, line, bindOptions);
        return;
    }
    if (t0 === "stats" && t1 === "socket") {
        markSpan(builder, line, 0, 1, "keyword");
        if (tokens[2]) {
            pushToken(builder, line.line, tokens[2], "string");
        }
        highlightBindParams(builder, line, 3, bindOptions);
        return;
    }
    if (t0 === "server") {
        pushToken(builder, line.line, tokens[0], "keyword");
        highlightServerLine(builder, line, options, bindOptions, serverOptions);
        return;
    }
    if (t0 === "http-request" ||
        t0 === "http-response" ||
        t0 === "http-after-response" ||
        t0 === "tcp-request" ||
        t0 === "tcp-response") {
        pushToken(builder, line.line, tokens[0], "keyword");
        highlightRuleLine(builder, line, options, bindOptions, serverOptions);
        return;
    }
    if (t0 === "acl") {
        pushToken(builder, line.line, tokens[0], "keyword");
        if (tokens[1]) {
            pushToken(builder, line.line, tokens[1], "variable");
        }
        if (tokens[2]) {
            pushToken(builder, line.line, tokens[2], "function");
        }
        highlightArguments(builder, line, 3, options, bindOptions, serverOptions);
        return;
    }
    const span = (0, tokenUtils_1.resolveDirectiveSpan)(line, sectionKeywords);
    const keywordStart = t0 === "no" || t0 === "default" ? 1 : span.start;
    if (keywordStart <= span.end && span.end >= 0) {
        markSpan(builder, line, keywordStart, span.end, "keyword");
    }
    highlightArguments(builder, line, span.end + 1, options, bindOptions, serverOptions);
}
function highlightSectionHeader(builder, line, declaration) {
    pushToken(builder, line.line, line.tokens[0], "section", declaration);
    let index = 1;
    if (index < line.tokens.length) {
        pushToken(builder, line.line, line.tokens[index], "sectionName");
        index += 1;
    }
    while (index < line.tokens.length) {
        if (line.tokens[index].text.toLowerCase() === "from") {
            pushToken(builder, line.line, line.tokens[index], "keyword");
            index += 1;
            if (index < line.tokens.length) {
                pushToken(builder, line.line, line.tokens[index], "sectionName");
                index += 1;
            }
        }
        else {
            pushToken(builder, line.line, line.tokens[index], "sectionName");
            index += 1;
        }
    }
}
function createSemanticTokensProvider(schema) {
    return {
        provideDocumentSemanticTokens(document) {
            if (document.lineCount > 4000) {
                return new vscode.SemanticTokensBuilder(legend).build();
            }
            const parsed = (0, parseCache_1.getParsedDocument)(document);
            const builder = new vscode.SemanticTokensBuilder(legend);
            const declaration = exports.tokenModifiers.indexOf("declaration");
            const options = new Set((schema.keyword_groups.options ?? []).map((v) => v.toLowerCase()));
            const bindOptions = new Set((schema.keyword_groups.bind_options ?? []).map((v) => v.toLowerCase()));
            const serverOptions = new Set((schema.keyword_groups.server_options ?? []).map((v) => v.toLowerCase()));
            for (const line of parsed) {
                if (line.tokens.length === 0) {
                    continue;
                }
                if (line.isSectionHeader) {
                    highlightSectionHeader(builder, line, declaration);
                    continue;
                }
                if (line.tokens[0].text.startsWith(".")) {
                    for (const token of line.tokens) {
                        pushToken(builder, line.line, token, "keyword");
                    }
                    continue;
                }
                highlightDirectiveLine(builder, line, sectionKeywordSet(schema, line.section), options, bindOptions, serverOptions);
            }
            return builder.build();
        },
    };
}
function semanticTokensLegend() {
    return legend;
}
//# sourceMappingURL=semanticTokens.js.map