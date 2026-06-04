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
exports.provideCompletionItems = provideCompletionItems;
const vscode = __importStar(require("vscode"));
const directiveUtils_1 = require("./directiveUtils");
const documentContext_1 = require("./documentContext");
function markdownDoc(description, docsUrl) {
    const md = new vscode.MarkdownString();
    if (description) {
        md.appendMarkdown(description);
    }
    if (docsUrl) {
        md.appendMarkdown(`\n\n[HAProxy documentation](${docsUrl})`);
    }
    return md;
}
function filterByPrefix(items, prefix) {
    const p = prefix.toLowerCase();
    if (!p) {
        return items;
    }
    return items.filter((item) => item.toLowerCase().startsWith(p));
}
function provideCompletionItems(document, position, data, schema) {
    const ctx = (0, documentContext_1.getDocumentContext)(document, position, schema);
    if (!ctx) {
        return [];
    }
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_.-]+/);
    const partial = wordRange ? document.getText(wordRange) : "";
    if (ctx.kind === "section" && ctx.line.tokens.length === 0) {
        return (0, documentContext_1.getSectionKeywords)(schema).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
            item.detail = "HAProxy section";
            return item;
        });
    }
    if (ctx.kind === "option") {
        const options = (0, documentContext_1.groupItems)(data, "options").map((g) => g.name);
        return filterByPrefix(options, partial).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
            const group = (0, documentContext_1.groupItems)(data, "options").find((g) => g.name === name);
            item.detail = "option";
            const optKeyword = data.keywords[`option ${name}`.toLowerCase()] ??
                data.keywords[`no option ${name}`.toLowerCase()];
            if (optKeyword?.description || group?.description) {
                item.documentation = markdownDoc(optKeyword?.description ?? group?.description ?? "", optKeyword?.docsUrl ?? group?.docsUrl);
            }
            return item;
        });
    }
    const actionGroupForKind = (kind) => {
        switch (kind) {
            case "http-request":
                return "http_request_actions";
            case "http-response":
                return "http_response_actions";
            case "http-after-response":
                return "http_after_response_actions";
            case "tcp-request":
                return "tcp_request_actions";
            case "tcp-response":
                return "tcp_response_actions";
            default:
                return null;
        }
    };
    if ((ctx.kind === "http-request" ||
        ctx.kind === "http-response" ||
        ctx.kind === "tcp-request" ||
        ctx.kind === "tcp-response") &&
        ctx.tokenIndex >= 2 &&
        ctx.line.tokens[1]?.text.toLowerCase() === "use-service") {
        const services = (0, documentContext_1.groupItems)(data, "services").map((g) => g.name);
        return filterByPrefix(services, partial).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
            item.detail = "service";
            return item;
        });
    }
    const actionKind = actionGroupForKind(ctx.kind);
    if (actionKind) {
        const actions = (0, documentContext_1.groupItems)(data, actionKind).map((g) => g.name);
        return filterByPrefix(actions, partial).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
            const group = (0, documentContext_1.groupItems)(data, actionKind).find((g) => g.name === name);
            item.detail = ctx.kind;
            if (group?.description) {
                item.documentation = markdownDoc(group.description, group.docsUrl);
            }
            return item;
        });
    }
    if (ctx.kind === "filter") {
        const filters = (0, documentContext_1.groupItems)(data, "filters").map((g) => g.name);
        return filterByPrefix(filters, partial).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
            item.detail = "filter";
            return item;
        });
    }
    if (ctx.kind === "expression-fetch" || ctx.kind === "expression-converter") {
        const groupName = ctx.kind === "expression-converter" ? "sample_converters" : "sample_fetches";
        const names = (0, documentContext_1.groupItems)(data, groupName).map((g) => g.name);
        return filterByPrefix(names, partial).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
            item.detail = groupName.replace("sample_", "");
            return item;
        });
    }
    if (ctx.kind === "acl-criterion") {
        const criteria = [
            ...(0, documentContext_1.groupItems)(data, "acl_criteria").map((g) => g.name),
            ...(0, documentContext_1.groupItems)(data, "sample_fetches").map((g) => g.name),
        ];
        return filterByPrefix(criteria, partial).map((name) => {
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
            item.detail = "ACL criterion";
            return item;
        });
    }
    if (ctx.kind === "directive-argument") {
        const sectionKeywords = (0, documentContext_1.keywordsForSection)(data, ctx.line.section);
        const allowed = new Set(sectionKeywords.map((kw) => kw.name.toLowerCase()));
        const directive = (0, directiveUtils_1.resolveDirective)(ctx.line, allowed);
        if (!directive.matched) {
            return [];
        }
        const kw = sectionKeywords.find((k) => k.name.toLowerCase() === directive.keyword.toLowerCase());
        const pos = (0, directiveUtils_1.argumentPosition)(ctx.tokenIndex, directive.end);
        const values = (0, directiveUtils_1.argumentValuesForPosition)(kw?.arguments, pos, ctx.line, directive.end) ??
            (0, directiveUtils_1.allArgumentValues)(kw?.arguments);
        return filterByPrefix(values.map((v) => v.name), partial).map((name) => {
            const value = values.find((v) => v.name === name);
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
            item.detail = kw?.name ?? "argument";
            if (value?.description) {
                item.documentation = markdownDoc(value.description, kw?.docsUrl);
            }
            return item;
        });
    }
    const section = ctx.line.section;
    const keywords = (0, documentContext_1.keywordsForSection)(data, section);
    const existing = new Set(ctx.line.tokens.map((t) => t.text.toLowerCase()));
    return keywords
        .filter((kw) => {
        if (ctx.tokenIndex === 0) {
            return kw.name.toLowerCase().startsWith(partial.toLowerCase());
        }
        return false;
    })
        .filter((kw) => !existing.has(kw.name.toLowerCase()) || ctx.tokenIndex === 0)
        .map((kw) => {
        const item = new vscode.CompletionItem(kw.name, vscode.CompletionItemKind.Keyword);
        item.detail =
            kw.signatures.length > 1 ? `${kw.signatures.length} forms` : kw.signatures[0] ?? kw.name;
        const sigList = kw.signatures.length > 1
            ? kw.signatures.map((s) => `- \`${s}\``).join("\n")
            : "";
        const doc = sigList ? `${kw.description}\n\n${sigList}` : kw.description;
        item.documentation = markdownDoc(doc, kw.docsUrl);
        return item;
    });
}
//# sourceMappingURL=completion.js.map