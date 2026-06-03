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
exports.argumentModelDiagnostics = argumentModelDiagnostics;
const vscode = __importStar(require("vscode"));
const directiveUtils_1 = require("./directiveUtils");
const tokenUtils_1 = require("./tokenUtils");
const COOKIE_MODES = new Set([
    "indirect",
    "insert",
    "nocache",
    "prefix",
    "rewrite",
    "postonly",
    "preserve",
    "httponly",
    "secure",
    "domain",
    "attr",
]);
const SKIP_KEYWORDS = new Set([
    "bind",
    "server",
    "acl",
    "option",
    "stats",
    "http-request",
    "http-response",
    "tcp-request",
    "tcp-response",
    "http-after-response",
    "http-check",
    "tcp-check",
]);
function diagRange(line, tokenIndex) {
    const tok = line.tokens[tokenIndex];
    return new vscode.Range(line.line, tok.start, line.line, tok.end);
}
function formatEnumHint(values) {
    if (values.length <= 6) {
        return values.join(", ");
    }
    return `${values.slice(0, 6).join(", ")}, ...`;
}
function makeArgDiagnostic(line, tokenIndex, message, code, severity = vscode.DiagnosticSeverity.Warning) {
    const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, severity);
    diagnostic.source = "haproxy";
    diagnostic.code = code;
    return diagnostic;
}
function isSimpleEnumName(name) {
    return /^[a-z][a-z0-9_.-]*$/i.test(name);
}
function docEnumValues(schemaKw) {
    const values = [];
    for (const param of schemaKw?.arguments ?? []) {
        for (const value of param.values) {
            const base = value.name.split("(", 1)[0];
            if (isSimpleEnumName(base)) {
                values.push(base.toLowerCase());
            }
        }
    }
    return values;
}
function shouldUseDocEnumHints(parameter) {
    if (!parameter) {
        return false;
    }
    const lower = parameter.toLowerCase();
    if (lower.includes("name") || lower.includes("addr") || lower.includes("path") || lower.includes("file")) {
        return false;
    }
    return lower.startsWith("<");
}
function enumValuesForSlot(slot, schemaKw, position) {
    const fromSignature = (slot?.enum ?? []).map((v) => v.toLowerCase());
    if (fromSignature.length > 0) {
        const values = new Set(fromSignature);
        for (const name of docEnumValues(schemaKw)) {
            values.add(name);
        }
        return [...values];
    }
    const param = schemaKw?.arguments?.[position] ??
        (position === 0 ? schemaKw?.arguments?.find((p) => p.parameter === "<algorithm>") : undefined);
    if (!shouldUseDocEnumHints(param?.parameter)) {
        return [];
    }
    const fromDoc = docEnumValues(schemaKw);
    if (fromDoc.length >= 2) {
        return [...new Set(fromDoc)];
    }
    return [];
}
function allowsMissingArgs(schemaKw, model) {
    if (model.min_args === 0) {
        return true;
    }
    const signatures = schemaKw?.signatures ?? [];
    if (signatures.length > 1) {
        return true;
    }
    if (model.slots.some((slot) => slot.optional)) {
        return true;
    }
    return false;
}
function argumentModelDiagnostics(line, schema, allowed, noPrefixKeywords) {
    const match = (0, tokenUtils_1.resolveLongestDirectiveMatch)(line, allowed, 4, noPrefixKeywords);
    if (!match.matched) {
        return [];
    }
    const keyword = match.keyword.toLowerCase();
    if (SKIP_KEYWORDS.has(keyword)) {
        return [];
    }
    const t0 = line.tokens[0]?.text.toLowerCase();
    if (t0 === "no" || t0 === "default") {
        const base = match.keyword.toLowerCase();
        if (line.tokens[1]?.text.toLowerCase() === "option" || noPrefixKeywords?.has(base)) {
            return [];
        }
    }
    if (tokenUtils_1.PREFIX_FAMILIES.includes(keyword) || (t0 && tokenUtils_1.PREFIX_FAMILIES.includes(t0))) {
        return [];
    }
    const schemaKw = schema.keywords[keyword];
    const model = schemaKw?.argument_model;
    if (!model || model.max_args === null || model.max_args === undefined) {
        return [];
    }
    const argIndices = (0, directiveUtils_1.argumentTokenIndices)(line, match.end);
    const diagnostics = [];
    if (keyword === "cookie") {
        return cookieArgumentDiagnostics(line, match, argIndices);
    }
    if (keyword === "balance") {
        return balanceArgumentDiagnostics(line, match, argIndices, model, schemaKw);
    }
    if (keyword === "option mysql-check") {
        return mysqlCheckOptionDiagnostics(line, match, argIndices);
    }
    if (argIndices.length < model.min_args && !allowsMissingArgs(schemaKw, model)) {
        const missing = model.min_args - argIndices.length;
        diagnostics.push(makeArgDiagnostic(line, match.end, `'${keyword}' expects at least ${model.min_args} argument(s) (${missing} missing)`, "missing-argument", vscode.DiagnosticSeverity.Error));
    }
    for (let pos = 0; pos < argIndices.length; pos += 1) {
        const tokenIdx = argIndices[pos];
        const slot = model.slots[pos];
        const value = line.tokens[tokenIdx].text;
        const allowedValues = enumValuesForSlot(slot, schemaKw, pos);
        if (pos >= model.max_args) {
            diagnostics.push(makeArgDiagnostic(line, tokenIdx, `'${keyword}' accepts at most ${model.max_args} argument(s); '${value}' is unexpected`, "extra-argument"));
            continue;
        }
        if (allowedValues.length === 0) {
            continue;
        }
        const lower = value.toLowerCase();
        const base = lower.split("(", 1)[0];
        if ((0, tokenUtils_1.isLikelyValue)(lower)) {
            continue;
        }
        const allowedSet = new Set(allowedValues);
        if (!allowedSet.has(lower) && !allowedSet.has(base)) {
            diagnostics.push(makeArgDiagnostic(line, tokenIdx, `Unknown value '${value}' for '${keyword}' (expected: ${formatEnumHint(allowedValues)})`, "unknown-value"));
        }
    }
    return diagnostics;
}
function cookieArgumentDiagnostics(line, match, argIndices) {
    const diagnostics = [];
    if (argIndices.length === 0) {
        diagnostics.push(makeArgDiagnostic(line, match.end, "'cookie' expects a cookie name", "missing-argument", vscode.DiagnosticSeverity.Error));
        return diagnostics;
    }
    for (let pos = 1; pos < argIndices.length; pos += 1) {
        const tokenIdx = argIndices[pos];
        const value = line.tokens[tokenIdx].text.toLowerCase();
        if (!COOKIE_MODES.has(value) && !(0, tokenUtils_1.isLikelyValue)(value)) {
            diagnostics.push(makeArgDiagnostic(line, tokenIdx, `Unknown cookie modifier '${line.tokens[tokenIdx].text}'`, "unknown-value"));
        }
    }
    return diagnostics;
}
function balanceArgumentDiagnostics(line, match, argIndices, model, schemaKw) {
    const diagnostics = [];
    if (argIndices.length === 0) {
        return diagnostics;
    }
    const algorithmSlot = model.slots[0];
    const allowedAlgorithms = enumValuesForSlot(algorithmSlot, schemaKw, 0);
    const algoIdx = argIndices[0];
    const algo = line.tokens[algoIdx].text.toLowerCase();
    if (allowedAlgorithms.length > 0 &&
        !allowedAlgorithms.includes(algo) &&
        !(0, tokenUtils_1.isLikelyValue)(algo)) {
        diagnostics.push(makeArgDiagnostic(line, algoIdx, `Unknown balance algorithm '${line.tokens[algoIdx].text}' (expected: ${formatEnumHint(allowedAlgorithms)})`, "unknown-value"));
    }
    if (argIndices.length > model.max_args) {
        const extra = argIndices[model.max_args];
        diagnostics.push(makeArgDiagnostic(line, extra, `'balance' accepts at most ${model.max_args} argument(s)`, "extra-argument"));
    }
    return diagnostics;
}
function mysqlCheckOptionDiagnostics(line, match, argIndices) {
    const diagnostics = [];
    if (argIndices.length === 0) {
        return diagnostics;
    }
    const first = line.tokens[argIndices[0]].text.toLowerCase();
    if (first === "user") {
        if (argIndices.length < 2) {
            diagnostics.push(makeArgDiagnostic(line, argIndices[0], "option mysql-check user expects a username", "missing-argument", vscode.DiagnosticSeverity.Error));
        }
        const modeIdx = argIndices.length >= 3 ? argIndices[2] : argIndices[1];
        if (argIndices.length >= 3) {
            const mode = line.tokens[modeIdx].text.toLowerCase();
            if (mode !== "post-41" && mode !== "pre-41") {
                diagnostics.push(makeArgDiagnostic(line, modeIdx, `Unknown mysql-check mode '${line.tokens[modeIdx].text}' (expected: post-41, pre-41)`, "unknown-value"));
            }
        }
        return diagnostics;
    }
    const mode = first;
    if (mode !== "post-41" && mode !== "pre-41" && !(0, tokenUtils_1.isLikelyValue)(mode)) {
        diagnostics.push(makeArgDiagnostic(line, argIndices[0], `Unknown value '${line.tokens[argIndices[0]].text}' for 'option mysql-check' (expected: user, post-41, pre-41)`, "unknown-value"));
    }
    return diagnostics;
}
//# sourceMappingURL=argumentDiagnostics.js.map