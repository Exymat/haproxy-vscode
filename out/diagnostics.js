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
exports.computeDiagnostics = computeDiagnostics;
const vscode = __importStar(require("vscode"));
const argumentDiagnostics_1 = require("./argumentDiagnostics");
const expressionDiagnostics_1 = require("./expressionDiagnostics");
const sectionDiagnostics_1 = require("./sectionDiagnostics");
const statementDiagnostics_1 = require("./statementDiagnostics");
const parseCache_1 = require("./parseCache");
const schema_1 = require("./schema");
const tokenUtils_1 = require("./tokenUtils");
const DIAG_SOURCE = "haproxy";
function diagRangeForTokens(line, startIdx, endIdx) {
    const startTok = line.tokens[startIdx];
    const endTok = line.tokens[endIdx];
    return new vscode.Range(line.line, startTok.start, line.line, endTok.end);
}
function diagRange(line, tokenIndex) {
    return diagRangeForTokens(line, tokenIndex, tokenIndex);
}
function makeDiagnostic(range, message, severity, code, related) {
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = DIAG_SOURCE;
    diagnostic.code = code;
    if (related && related.length > 0) {
        diagnostic.relatedInformation = related;
    }
    return diagnostic;
}
function isMacroLine(line, schema) {
    const first = line.tokens[0]?.text.toLowerCase();
    return (schema.tokens.macros ?? []).some((macro) => first === macro.toLowerCase());
}
function keywordSections(schema, keyword) {
    return schema.keywords[keyword.toLowerCase()]?.sections ?? [];
}
function wrongSectionMessage(keyword, section, sections) {
    if (sections.length === 0) {
        return `'${keyword}' is not supported in section '${section}'`;
    }
    if (sections.length <= 3) {
        return `'${keyword}' is not supported in section '${section}' (allowed in: ${sections.join(", ")})`;
    }
    return `'${keyword}' is not supported in section '${section}'`;
}
function isOptionLine(line) {
    const t0 = line.tokens[0]?.text.toLowerCase();
    const t1 = line.tokens[1]?.text.toLowerCase();
    return t0 === "option" || (t0 === "no" && t1 === "option");
}
function optionAllowedInSection(allowed) {
    if (allowed.has("option")) {
        return true;
    }
    for (const keyword of allowed) {
        if (keyword.startsWith("option ") || keyword.startsWith("no option")) {
            return true;
        }
    }
    return false;
}
function topLevelDiagnostics(line, schema, allowed, noPrefix) {
    const match = (0, tokenUtils_1.resolveLongestDirectiveMatch)(line, allowed, 4, noPrefix);
    if (match.matched) {
        return [];
    }
    if (isOptionLine(line) && optionAllowedInSection(allowed)) {
        return [];
    }
    const range = diagRangeForTokens(line, match.start, Math.max(match.end, match.start));
    const keyword = match.keyword;
    const section = line.section ?? "none";
    const otherSections = keywordSections(schema, keyword);
    if (otherSections.length > 0 && line.section && !otherSections.includes(line.section)) {
        return [
            makeDiagnostic(range, wrongSectionMessage(keyword, section, otherSections), vscode.DiagnosticSeverity.Error, "wrong-section"),
        ];
    }
    const prefix = line.tokens[0]?.text.toLowerCase();
    if (prefix && tokenUtils_1.PREFIX_FAMILIES.includes(prefix)) {
        const sub = (0, tokenUtils_1.resolveSubcommandSpan)(line, allowed, prefix);
        if (sub && !sub.matched) {
            return [
                makeDiagnostic(diagRangeForTokens(line, sub.start, sub.end), `Unknown ${prefix} subcommand '${sub.subcommand}' in section '${section}'`, vscode.DiagnosticSeverity.Error, "unknown-keyword"),
            ];
        }
    }
    if (otherSections.length > 0) {
        return [
            makeDiagnostic(range, wrongSectionMessage(keyword, section, otherSections), vscode.DiagnosticSeverity.Error, "wrong-section"),
        ];
    }
    return [
        makeDiagnostic(range, `Unknown keyword '${keyword}' in section '${section}'`, vscode.DiagnosticSeverity.Error, "unknown-keyword"),
    ];
}
function unknownNestedDiagnostics(line, schema) {
    const diagnostics = [];
    const groups = schema.keyword_groups;
    const t0 = line.tokens[0]?.text.toLowerCase();
    const t1 = line.tokens[1]?.text.toLowerCase();
    if (t0 === "option" || (t0 === "no" && t1 === "option")) {
        const idx = t0 === "option" ? 1 : 2;
        const value = line.tokens[idx]?.text.toLowerCase();
        if (value && !(groups.options ?? []).includes(value)) {
            diagnostics.push(makeDiagnostic(diagRange(line, idx), `Unknown option keyword '${line.tokens[idx].text}'`, vscode.DiagnosticSeverity.Warning, "unknown-option"));
        }
        return diagnostics;
    }
    if (t0 === "mode") {
        return diagnostics;
    }
    if (t0 === "balance") {
        return diagnostics;
    }
    if (t0 === "acl" && line.tokens.length >= 3) {
        const rawCriterion = line.tokens[2].text;
        const parenIdx = rawCriterion.indexOf("(");
        const criterion = (parenIdx >= 0 ? rawCriterion.slice(0, parenIdx) : rawCriterion).toLowerCase();
        const allowedCriteria = new Set([...(groups.acl_criteria ?? []), ...(groups.sample_fetches ?? [])].map((v) => v.toLowerCase()));
        if (!(0, tokenUtils_1.isLikelyValue)(criterion) && !allowedCriteria.has(criterion)) {
            diagnostics.push(makeDiagnostic(diagRange(line, 2), `Unknown ACL criterion '${rawCriterion}'`, vscode.DiagnosticSeverity.Warning, "unknown-criterion"));
        }
        return diagnostics;
    }
    if (t0 === "bind" || t0 === "server") {
        return diagnostics;
    }
    if (t0 === "stats" && t1 === "socket") {
        for (let i = 2; i < line.tokens.length; i += 1) {
            const val = line.tokens[i].text.toLowerCase().replace(/\*$/, "");
            if (val === "level" && i + 1 < line.tokens.length) {
                const levelValue = line.tokens[i + 1].text.toLowerCase();
                if (!tokenUtils_1.BIND_LEVEL_VALUES.has(levelValue)) {
                    diagnostics.push(makeDiagnostic(diagRange(line, i + 1), `Unknown level '${line.tokens[i + 1].text}' (expected user, operator, or admin)`, vscode.DiagnosticSeverity.Warning, "unknown-value"));
                }
                i += 1;
            }
        }
        return diagnostics;
    }
    const phaseIdx = (0, tokenUtils_1.tcpPhaseIndex)(line);
    if (phaseIdx !== null) {
        const phase = line.tokens[phaseIdx].text.toLowerCase();
        if (!tokenUtils_1.TCP_RULE_PHASES.has(phase)) {
            diagnostics.push(makeDiagnostic(diagRange(line, phaseIdx), `Unknown ${t0} phase '${line.tokens[phaseIdx].text}'`, vscode.DiagnosticSeverity.Warning, "unknown-value"));
        }
    }
    const actionIdx = (0, tokenUtils_1.actionTokenIndex)(line);
    if (actionIdx !== null) {
        const rawToken = line.tokens[actionIdx].text;
        const token = (0, tokenUtils_1.normalizeActionName)(rawToken);
        let allowedActions = [];
        if (t0 === "http-request") {
            allowedActions = groups.http_request_actions ?? [];
        }
        else if (t0 === "http-response") {
            allowedActions = groups.http_response_actions ?? [];
        }
        else if (t0 === "http-after-response") {
            allowedActions = groups.http_after_response_actions ?? [];
        }
        else if (t0 === "tcp-request") {
            allowedActions = groups.tcp_request_actions ?? [];
        }
        else if (t0 === "tcp-response") {
            allowedActions = groups.tcp_response_actions ?? [];
        }
        const allowed = new Set(allowedActions.map((v) => v.toLowerCase()));
        if (token && !token.startsWith("lua.") && !allowed.has(token)) {
            diagnostics.push(makeDiagnostic(diagRange(line, actionIdx), `Unknown ${line.tokens[0].text} action '${rawToken}'`, vscode.DiagnosticSeverity.Warning, "unknown-action"));
        }
        else if (token === "use-service" && actionIdx + 1 < line.tokens.length) {
            const serviceIdx = actionIdx + 1;
            const serviceName = line.tokens[serviceIdx].text.toLowerCase();
            const services = new Set((groups.services ?? []).map((v) => v.toLowerCase()));
            if (services.size > 0 && serviceName && !services.has(serviceName)) {
                diagnostics.push(makeDiagnostic(diagRange(line, serviceIdx), `Unknown service '${line.tokens[serviceIdx].text}'`, vscode.DiagnosticSeverity.Warning, "unknown-service"));
            }
        }
    }
    return diagnostics;
}
function computeDiagnostics(document, schema) {
    const parsed = (0, parseCache_1.getParsedDocument)(document);
    const diagnostics = [];
    const lineTexts = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
    for (const line of parsed) {
        if (line.tokens.length === 0) {
            continue;
        }
        if (line.isSectionHeader) {
            diagnostics.push(...(0, sectionDiagnostics_1.sectionHeaderDiagnostics)(line));
            continue;
        }
        if (isMacroLine(line, schema)) {
            continue;
        }
        const allowed = (0, schema_1.sectionKeywordSet)(schema, line.section);
        const noPrefix = (0, schema_1.noPrefixKeywordSet)(schema);
        const topDiags = topLevelDiagnostics(line, schema, allowed, noPrefix);
        diagnostics.push(...topDiags);
        if (topDiags.length === 0) {
            diagnostics.push(...(0, statementDiagnostics_1.statementDiagnostics)(line, schema));
            diagnostics.push(...unknownNestedDiagnostics(line, schema));
            diagnostics.push(...(0, argumentDiagnostics_1.argumentModelDiagnostics)(line, schema, allowed, noPrefix));
        }
        diagnostics.push(...(0, sectionDiagnostics_1.aclNameDiagnostics)(line));
        diagnostics.push(...(0, expressionDiagnostics_1.expressionDiagnostics)(line, lineTexts[line.line] ?? "", schema));
    }
    return diagnostics;
}
//# sourceMappingURL=diagnostics.js.map