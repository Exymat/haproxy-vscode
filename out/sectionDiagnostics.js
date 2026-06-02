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
exports.sectionHeaderDiagnostics = sectionHeaderDiagnostics;
exports.aclNameDiagnostics = aclNameDiagnostics;
const vscode = __importStar(require("vscode"));
const nameValidation_1 = require("./nameValidation");
const DIAG_SOURCE = "haproxy";
const NAMED_SECTIONS = new Set(["frontend", "backend", "listen", "defaults", "peers", "userlist"]);
function diagRange(line, tokenIndex) {
    const tok = line.tokens[tokenIndex];
    return new vscode.Range(line.line, tok.start, line.line, tok.end);
}
function makeError(line, tokenIndex, message, code) {
    const diagnostic = new vscode.Diagnostic(diagRange(line, tokenIndex), message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = DIAG_SOURCE;
    diagnostic.code = code;
    return diagnostic;
}
function sectionHeaderDiagnostics(line) {
    if (!line.isSectionHeader || line.tokens.length < 2) {
        return [];
    }
    const section = line.tokens[0].text.toLowerCase();
    const diagnostics = [];
    if (NAMED_SECTIONS.has(section)) {
        const name = line.tokens[1].text;
        const bad = (0, nameValidation_1.findInvalidNameChar)(name);
        if (bad !== null) {
            diagnostics.push(makeError(line, 1, `character '${bad}' is not permitted in '${section}' name '${name}'`, "invalid-name"));
        }
    }
    if (section === "frontend" || section === "listen") {
        for (let i = 2; i < line.tokens.length; i += 1) {
            const tok = line.tokens[i].text.toLowerCase();
            if (tok === "from") {
                return diagnostics;
            }
            if ((0, nameValidation_1.looksLikeListenAddress)(line.tokens[i].text)) {
                diagnostics.push(makeError(line, i, "please use the 'bind' keyword for listening addresses", "legacy-bind-syntax"));
                return diagnostics;
            }
        }
    }
    return diagnostics;
}
function aclNameDiagnostics(line) {
    if (line.tokens[0]?.text.toLowerCase() !== "acl" || line.tokens.length < 3) {
        return [];
    }
    const name = line.tokens[1].text;
    const bad = (0, nameValidation_1.findInvalidNameChar)(name);
    if (bad === null) {
        return [];
    }
    return [
        makeError(line, 1, `character '${bad}' is not permitted in acl name '${name}'`, "invalid-name"),
    ];
}
//# sourceMappingURL=sectionDiagnostics.js.map