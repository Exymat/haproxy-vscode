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
exports.statementDiagnostics = statementDiagnostics;
const vscode = __importStar(require("vscode"));
const addressFormat_1 = require("./addressFormat");
const directiveUtils_1 = require("./directiveUtils");
const tokenUtils_1 = require("./tokenUtils");
const DIAG_SOURCE = "haproxy";
const SERVER_ADDRESS_OPTION_POLICIES = {
    source: "serverSource",
    usesrc: "serverUsesrc",
    socks4: "serverSocks4",
};
function diagRange(line, tokenIndex) {
    const tok = line.tokens[tokenIndex];
    return new vscode.Range(line.line, tok.start, line.line, tok.end);
}
function makeDiagnostic(line, tokenIndex, message, code, severity = vscode.DiagnosticSeverity.Error) {
    const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, severity);
    diagnostic.source = DIAG_SOURCE;
    diagnostic.code = code;
    return diagnostic;
}
function pushAddressResult(line, tokenIndex, result, diagnostics) {
    if (result.valid || !result.message) {
        return;
    }
    const code = (result.code ?? "invalid-address");
    diagnostics.push(makeDiagnostic(line, tokenIndex, result.message, code));
}
function findStatementRule(schema, line) {
    const t0 = line.tokens[0]?.text.toLowerCase();
    if (!t0) {
        return undefined;
    }
    const t1 = line.tokens[1]?.text.toLowerCase();
    for (const rule of schema.statement_rules) {
        if (rule.prefix === "no" && t0 === "no") {
            continue;
        }
        if (rule.prefix && rule.prefix !== t0) {
            continue;
        }
        if (rule.keyword.toLowerCase() === t0) {
            return rule;
        }
        if (rule.prefix && `${rule.prefix} ${rule.keyword}`.toLowerCase() === `${t0} ${t1}`) {
            return rule;
        }
    }
    return undefined;
}
function policyForSlot(rule, spec, token) {
    if (rule.kind === "bind") {
        return token.startsWith("/") ? { ...addressFormat_1.ADDRESS_POLICIES.bind, portMandatory: false } : addressFormat_1.ADDRESS_POLICIES.bind;
    }
    if (rule.kind === "server" && spec.role === "address") {
        return addressFormat_1.ADDRESS_POLICIES.server;
    }
    if (rule.kind === "log" || rule.keyword === "log") {
        return addressFormat_1.ADDRESS_POLICIES.log;
    }
    if (rule.keyword === "source") {
        return addressFormat_1.ADDRESS_POLICIES.source;
    }
    return addressFormat_1.ADDRESS_POLICIES.server;
}
function validateFixedSlots(line, rule) {
    const diagnostics = [];
    const slots = rule.fixed_slots ?? [];
    if (slots.length === 0) {
        return diagnostics;
    }
    const nestedStart = rule.nested_start_index ?? 1 + slots.length;
    const condStart = (0, directiveUtils_1.conditionalStartIndex)(line, 0);
    const limit = Math.min(condStart, nestedStart);
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
        const tokenIdx = 1 + slotIdx;
        if (tokenIdx >= limit) {
            diagnostics.push(makeDiagnostic(line, Math.max(1, line.tokens.length - 1), `'${rule.keyword}' is missing required argument`, "missing-argument"));
            break;
        }
        const token = line.tokens[tokenIdx].text;
        const spec = slots[slotIdx];
        if (spec.role === "name") {
            const lower = token.toLowerCase();
            if (lower === "check" || lower === "inter") {
                diagnostics.push(makeDiagnostic(line, tokenIdx, `'${token}' is a server parameter name, not a server name`, "reserved-name", vscode.DiagnosticSeverity.Warning));
            }
            continue;
        }
        if (spec.role === "address") {
            if (rule.kind === "server" && (0, addressFormat_1.isServerMainAddressPlaceholder)(token)) {
                continue;
            }
            const policy = policyForSlot(rule, spec, token);
            pushAddressResult(line, tokenIdx, (0, addressFormat_1.validateHaproxyAddress)(token, policy), diagnostics);
        }
    }
    return diagnostics;
}
function optionValuePolicy(rule, option) {
    const lower = option.toLowerCase();
    if (rule.kind === "server") {
        const named = SERVER_ADDRESS_OPTION_POLICIES[lower];
        if (named) {
            return addressFormat_1.ADDRESS_POLICIES[named];
        }
        if (tokenUtils_1.SERVER_OPTIONS_WITH_VALUE.has(lower)) {
            return null;
        }
    }
    if (rule.kind === "bind" && tokenUtils_1.BIND_OPTIONS_WITH_VALUE.has(lower)) {
        return null;
    }
    return null;
}
function scanNestedOptions(line, rule, schema) {
    const diagnostics = [];
    const nestedStart = rule.nested_start_index ?? line.tokens.length;
    const groupName = rule.group;
    if (!groupName) {
        return diagnostics;
    }
    const allowed = new Set((schema.keyword_groups[groupName] ?? []).map((v) => v.toLowerCase()));
    const condStart = (0, directiveUtils_1.conditionalStartIndex)(line, 0);
    let i = nestedStart;
    while (i < condStart) {
        const raw = line.tokens[i].text;
        const opt = raw.toLowerCase().replace(/\*$/, "");
        if (!opt) {
            i += 1;
            continue;
        }
        if (allowed.has(opt)) {
            const addrPolicy = optionValuePolicy(rule, opt);
            if (addrPolicy && i + 1 < condStart) {
                pushAddressResult(line, i + 1, (0, addressFormat_1.validateHaproxyAddress)(line.tokens[i + 1].text, addrPolicy), diagnostics);
                i += 2;
                continue;
            }
            const takesValue = rule.kind === "server"
                ? tokenUtils_1.SERVER_OPTIONS_WITH_VALUE.has(opt)
                : rule.kind === "bind"
                    ? tokenUtils_1.BIND_OPTIONS_WITH_VALUE.has(opt)
                    : false;
            if (takesValue && i + 1 < condStart) {
                const next = line.tokens[i + 1].text.toLowerCase();
                if (!allowed.has(next.replace(/\*$/, ""))) {
                    i += 2;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        if (/^[0-9]/.test(opt) || /^[0-9].*s$/i.test(opt)) {
            i += 1;
            continue;
        }
        diagnostics.push(makeDiagnostic(line, i, `Unknown ${rule.keyword} parameter '${raw}'`, "unknown-parameter", vscode.DiagnosticSeverity.Warning));
        i += 1;
    }
    return diagnostics;
}
const LOG_ADDRESS_SKIP = new Set(["global", "stdout", "stderr"]);
function logLineDiagnostics(line) {
    if (line.tokens[0]?.text.toLowerCase() !== "log" || line.tokens.length < 2) {
        return [];
    }
    const target = line.tokens[1].text;
    const lower = target.toLowerCase();
    if (LOG_ADDRESS_SKIP.has(lower) || lower.startsWith("@") || target.startsWith("/")) {
        return [];
    }
    const diagnostics = [];
    pushAddressResult(line, 1, (0, addressFormat_1.validateHaproxyAddress)(target, addressFormat_1.ADDRESS_POLICIES.log), diagnostics);
    return diagnostics;
}
function sourceLineDiagnostics(line) {
    if (line.tokens[0]?.text.toLowerCase() !== "source" || line.tokens.length < 2) {
        return [];
    }
    const diagnostics = [];
    pushAddressResult(line, 1, (0, addressFormat_1.validateHaproxyAddress)(line.tokens[1].text, addressFormat_1.ADDRESS_POLICIES.source), diagnostics);
    return diagnostics;
}
function tcpCheckLineDiagnostics(line) {
    const t0 = line.tokens[0]?.text.toLowerCase();
    if (t0 !== "tcp-check" && t0 !== "http-check") {
        return [];
    }
    const diagnostics = [];
    for (let i = 1; i < line.tokens.length - 1; i += 1) {
        if (line.tokens[i].text.toLowerCase() === "addr") {
            pushAddressResult(line, i + 1, (0, addressFormat_1.validateHaproxyAddress)(line.tokens[i + 1].text, addressFormat_1.ADDRESS_POLICIES.tcpCheckAddr), diagnostics);
        }
    }
    return diagnostics;
}
function statementDiagnostics(line, schema) {
    const t0 = line.tokens[0]?.text.toLowerCase() ?? "";
    if (t0 === "log") {
        return logLineDiagnostics(line);
    }
    if (t0 === "source") {
        return sourceLineDiagnostics(line);
    }
    if (t0 === "tcp-check" || t0 === "http-check") {
        return tcpCheckLineDiagnostics(line);
    }
    const rule = findStatementRule(schema, line);
    if (!rule?.fixed_slots?.length) {
        return [];
    }
    const diagnostics = [];
    diagnostics.push(...validateFixedSlots(line, rule));
    diagnostics.push(...scanNestedOptions(line, rule, schema));
    return diagnostics;
}
//# sourceMappingURL=statementDiagnostics.js.map