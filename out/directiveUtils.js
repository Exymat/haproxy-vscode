"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDirective = resolveDirective;
exports.conditionalStartIndex = conditionalStartIndex;
exports.argumentTokenIndices = argumentTokenIndices;
exports.argumentPosition = argumentPosition;
exports.findArgumentValue = findArgumentValue;
exports.argumentValuesForPosition = argumentValuesForPosition;
exports.allArgumentValues = allArgumentValues;
exports.getKeywordFromLanguage = getKeywordFromLanguage;
exports.getKeywordFromSchema = getKeywordFromSchema;
const tokenUtils_1 = require("./tokenUtils");
function resolveDirective(line, allowed) {
    const match = (0, tokenUtils_1.resolveLongestDirectiveMatch)(line, allowed);
    return {
        keyword: match.keyword,
        start: match.start,
        end: match.end,
        matched: match.matched,
    };
}
function conditionalStartIndex(line, afterDirective) {
    for (let i = line.tokens.length - 1; i > afterDirective; i -= 1) {
        const lower = line.tokens[i].text.toLowerCase();
        if (lower === "if" || lower === "unless") {
            return i;
        }
    }
    return line.tokens.length;
}
function argumentTokenIndices(line, directiveEnd) {
    const end = conditionalStartIndex(line, directiveEnd);
    const indices = [];
    for (let i = directiveEnd + 1; i < end; i += 1) {
        indices.push(i);
    }
    return indices;
}
function argumentPosition(tokenIndex, directiveEnd) {
    return Math.max(0, tokenIndex - directiveEnd - 1);
}
function normalizeValueName(token) {
    const paren = token.indexOf("(");
    return (paren >= 0 ? token.slice(0, paren) : token).toLowerCase();
}
function findArgumentValue(params, tokenText) {
    if (!params) {
        return undefined;
    }
    const key = normalizeValueName(tokenText);
    for (const param of params) {
        for (const value of param.values) {
            if (normalizeValueName(value.name) === key) {
                return { name: value.name, description: value.description, parameter: param.parameter };
            }
        }
    }
    return undefined;
}
function argumentValuesForPosition(params, position, line, directiveEnd) {
    if (!params || params.length === 0) {
        return [];
    }
    if (params.length === 1) {
        return params[0].values;
    }
    const firstArg = line.tokens[directiveEnd + 1]?.text.toLowerCase() ?? "";
    const urlParam = params.find((p) => p.parameter === "url_param");
    const algorithm = params.find((p) => p.parameter === "<algorithm>" || p.parameter === "");
    if (firstArg === "url_param" && urlParam) {
        return position <= 0 ? [{ name: "url_param", description: urlParam.description }] : urlParam.values;
    }
    if (algorithm && algorithm.values.length > 0) {
        return algorithm.values;
    }
    const slot = params[Math.min(position, params.length - 1)];
    return slot?.values ?? [];
}
function allArgumentValues(params) {
    if (!params) {
        return [];
    }
    const seen = new Set();
    const out = [];
    for (const param of params) {
        for (const value of param.values) {
            const key = value.name.toLowerCase();
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(value);
        }
    }
    return out;
}
function getKeywordFromLanguage(data, keyword) {
    return data.keywords[keyword.toLowerCase()];
}
function getKeywordFromSchema(schema, keyword) {
    return schema.keywords[keyword.toLowerCase()];
}
//# sourceMappingURL=directiveUtils.js.map