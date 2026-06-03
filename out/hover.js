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
exports.provideHover = provideHover;
const vscode = __importStar(require("vscode"));
const directiveUtils_1 = require("./directiveUtils");
const documentContext_1 = require("./documentContext");
const languageData_1 = require("./languageData");
function hoverMarkdown(title, signature, description, extras, docsUrl) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${title}**`);
    if (signature) {
        md.appendMarkdown(`\n\n\`${signature}\``);
    }
    if (description) {
        md.appendMarkdown(`\n\n${description}`);
    }
    for (const line of extras) {
        md.appendMarkdown(`\n\n${line}`);
    }
    if (docsUrl) {
        md.appendMarkdown(`\n\n[HAProxy documentation](${docsUrl})`);
    }
    return md;
}
function findGroupItem(data, name) {
    const lower = name.toLowerCase();
    for (const items of Object.values(data.groups)) {
        const hit = items.find((item) => item.name.toLowerCase() === lower);
        if (hit) {
            return hit;
        }
    }
    return undefined;
}
function signaturesBlock(signatures) {
    if (signatures.length === 0) {
        return "";
    }
    if (signatures.length === 1) {
        return signatures[0];
    }
    return signatures.map((sig) => `- \`${sig}\``).join("\n");
}
function provideHover(document, position, data, schema) {
    const ctx = (0, documentContext_1.getDocumentContext)(document, position, schema);
    if (!ctx || !ctx.token) {
        return null;
    }
    const range = new vscode.Range(ctx.line.line, ctx.token.start, ctx.line.line, ctx.token.end);
    const tokenLower = ctx.token.text.toLowerCase();
    if (ctx.kind === "option" && ctx.tokenIndex >= 1) {
        const group = (0, documentContext_1.groupItems)(data, "options").find((g) => g.name.toLowerCase() === tokenLower);
        if (group) {
            return new vscode.Hover(hoverMarkdown(group.name, "option " + group.name, group.description, []), range);
        }
    }
    const actionGroups = [
        "http_request_actions",
        "http_response_actions",
        "http_after_response_actions",
        "tcp_request_actions",
        "tcp_response_actions",
    ];
    for (const groupName of actionGroups) {
        const group = (0, documentContext_1.groupItems)(data, groupName).find((g) => g.name.toLowerCase() === tokenLower);
        if (group) {
            const extras = [];
            if (group.rulesets.length > 0) {
                extras.push(`**Rulesets:** ${group.rulesets.join(", ")}`);
            }
            return new vscode.Hover(hoverMarkdown(group.name, group.signature, group.description, extras), range);
        }
    }
    if (ctx.kind === "acl-criterion" && ctx.tokenIndex >= 2) {
        const group = findGroupItem(data, ctx.token.text);
        if (group) {
            return new vscode.Hover(hoverMarkdown(group.name, group.signature, group.description, []), range);
        }
    }
    const aclRefGroups = [
        "acl_flags",
        "acl_match_methods",
        "acl_int_operators",
        "acl_string_match_methods",
        "acl_predefined",
    ];
    for (const groupName of aclRefGroups) {
        const group = (0, documentContext_1.groupItems)(data, groupName).find((g) => g.name.toLowerCase() === tokenLower);
        if (group) {
            return new vscode.Hover(hoverMarkdown(group.name, group.signature, group.description, []), range);
        }
    }
    const sectionKeywords = (0, documentContext_1.keywordsForSection)(data, ctx.line.section);
    const allowed = new Set(sectionKeywords.map((kw) => kw.name.toLowerCase()));
    const directive = (0, directiveUtils_1.resolveDirective)(ctx.line, allowed);
    if (directive.matched && ctx.tokenIndex > directive.end) {
        const kw = (0, directiveUtils_1.getKeywordFromLanguage)(data, directive.keyword);
        const argValue = (0, directiveUtils_1.findArgumentValue)(kw?.arguments, ctx.token.text);
        if (argValue) {
            const extras = [];
            if (argValue.parameter) {
                extras.push(`**Parameter:** ${argValue.parameter}`);
            }
            if (kw) {
                extras.push(`**Directive:** ${kw.name}`);
            }
            return new vscode.Hover(hoverMarkdown(argValue.name, "", argValue.description, extras, kw?.docsUrl), range);
        }
    }
    const combined = ctx.line.tokens
        .slice(0, Math.min(ctx.tokenIndex + 1, 4))
        .map((t) => t.text)
        .join(" ");
    const kw = (0, languageData_1.findKeywordByPrefix)(data, combined) ??
        (directive.matched ? (0, directiveUtils_1.getKeywordFromLanguage)(data, directive.keyword) : undefined);
    if (!kw) {
        const group = findGroupItem(data, ctx.token.text);
        if (group) {
            return new vscode.Hover(hoverMarkdown(group.name, group.signature, group.description, []), range);
        }
        return null;
    }
    const onDirectiveToken = ctx.tokenIndex <= directive.end;
    const extras = [];
    if (kw.sections.length > 0) {
        extras.push(`**Valid in:** ${kw.sections.join(", ")}`);
    }
    if (onDirectiveToken) {
        if (kw.signatures.length > 1) {
            extras.unshift(`**Forms:**\n${signaturesBlock(kw.signatures)}`);
            return new vscode.Hover(hoverMarkdown(kw.name, "", kw.description, extras, kw.docsUrl), range);
        }
        return new vscode.Hover(hoverMarkdown(kw.name, kw.signatures[0] ?? kw.name, kw.description, extras, kw.docsUrl), range);
    }
    const pos = (0, directiveUtils_1.argumentPosition)(ctx.tokenIndex, directive.end);
    const param = kw.arguments?.[Math.min(pos, (kw.arguments?.length ?? 1) - 1)];
    if (param?.description) {
        extras.push(`**Parameter:** ${param.parameter || "argument"}`);
        extras.push(param.description);
    }
    return new vscode.Hover(hoverMarkdown(kw.name, kw.signatures[0] ?? kw.name, kw.description, extras, kw.docsUrl), range);
}
//# sourceMappingURL=hover.js.map