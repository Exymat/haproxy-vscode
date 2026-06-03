"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocumentContext = getDocumentContext;
exports.keywordsForSection = keywordsForSection;
exports.groupItems = groupItems;
exports.sectionKeywordNames = sectionKeywordNames;
exports.getSectionKeywords = getSectionKeywords;
const parseCache_1 = require("./parseCache");
const schema_1 = require("./schema");
function tokenAtPosition(line, character) {
    for (let i = 0; i < line.tokens.length; i += 1) {
        const tok = line.tokens[i];
        if (character >= tok.start && character <= tok.end) {
            return { index: i, token: tok };
        }
    }
    return null;
}
function linePrefixBeforeCursor(lineText, character) {
    return lineText.slice(0, character);
}
function ruleMatchesLine(rule, tokens) {
    if (tokens.length === 0) {
        return false;
    }
    const t0 = tokens[0].text.toLowerCase();
    if (rule.prefix) {
        const parts = rule.prefix.split(/\s+/);
        if (parts.length === 1) {
            return t0 === parts[0] && tokens[1]?.text.toLowerCase() === rule.keyword;
        }
        return false;
    }
    return t0 === rule.keyword;
}
function classifyByRules(rules, line, tokenIndex) {
    for (const rule of rules) {
        if (!ruleMatchesLine(rule, line.tokens)) {
            continue;
        }
        const minIdx = rule.value_token_index ??
            rule.action_token_index ??
            rule.nested_start_index ??
            rule.phase_token_index ??
            1;
        if (tokenIndex >= minIdx) {
            return rule.kind;
        }
    }
    return null;
}
function expressionKindAt(lineText, character) {
    const before = lineText.slice(0, character);
    const exprStart = Math.max(before.lastIndexOf("%["), before.lastIndexOf("{"));
    if (exprStart < 0) {
        return null;
    }
    const inner = before.slice(exprStart);
    if (inner.includes(":") && !inner.endsWith(":")) {
        return "expression-converter";
    }
    return "expression-fetch";
}
function getDocumentContext(document, position, schema) {
    const parsed = (0, parseCache_1.getParsedDocument)(document);
    const line = parsed[position.line];
    if (!line || line.isSectionHeader) {
        return null;
    }
    const lineText = document.lineAt(position.line).text;
    const hit = tokenAtPosition(line, position.character);
    const tokenIndex = hit?.index ?? Math.max(0, line.tokens.length - 1);
    const token = hit?.token ?? line.tokens[tokenIndex] ?? null;
    const prefix = linePrefixBeforeCursor(lineText, position.character);
    const exprKind = expressionKindAt(lineText, position.character);
    if (exprKind) {
        return { line, lineText, tokenIndex, token, kind: exprKind, prefix };
    }
    if (line.tokens.length === 0) {
        const trimmed = lineText.trim();
        if (!trimmed) {
            return { line, lineText, tokenIndex: 0, token: null, kind: "section", prefix: "" };
        }
    }
    const fromRules = classifyByRules(schema.statement_rules ?? [], line, tokenIndex);
    if (fromRules) {
        return { line, lineText, tokenIndex, token, kind: fromRules, prefix };
    }
    if (tokenIndex > 0) {
        return { line, lineText, tokenIndex, token, kind: "directive-argument", prefix };
    }
    return { line, lineText, tokenIndex, token, kind: "directive", prefix };
}
function keywordsForSection(data, section) {
    if (!section) {
        return [];
    }
    return Object.values(data.keywords).filter((kw) => kw.sections.includes(section));
}
function groupItems(data, groupName) {
    return data.groups[groupName] ?? [];
}
function sectionKeywordNames(data, section) {
    return keywordsForSection(data, section).map((kw) => kw.name);
}
function getSectionKeywords(schema) {
    return (0, schema_1.sectionNames)(schema);
}
//# sourceMappingURL=documentContext.js.map