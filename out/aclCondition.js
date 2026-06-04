"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAclConditionSpans = extractAclConditionSpans;
exports.validateAclConditions = validateAclConditions;
const sampleExpression_1 = require("./sampleExpression");
function findClosingBrace(lineText, open) {
    let depth = 0;
    let squote = false;
    let dquote = false;
    for (let i = open; i < lineText.length; i++) {
        const ch = lineText[i];
        if (ch === '"' && !squote) {
            dquote = !dquote;
            continue;
        }
        if (ch === "'" && !dquote) {
            squote = !squote;
            continue;
        }
        if (squote || dquote) {
            continue;
        }
        if (ch === "{") {
            depth++;
        }
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}
function isAclOnlyCriterion(name, schema, fetchNames, fetches) {
    const lower = name.toLowerCase();
    const inAcl = (schema.keyword_groups.acl_criteria ?? []).some((criterion) => criterion.toLowerCase() === lower);
    if (!inAcl) {
        return false;
    }
    if (fetchNames.has(name) || fetchNames.has(lower) || fetches[name] || fetches[lower]) {
        return false;
    }
    return true;
}
function extractAclConditionSpans(lineText) {
    const spans = [];
    let idx = 0;
    while (idx < lineText.length) {
        const open = lineText.indexOf("{", idx);
        if (open < 0) {
            break;
        }
        if (open > 0 && lineText[open - 1] === "%") {
            idx = open + 1;
            continue;
        }
        const close = findClosingBrace(lineText, open);
        const start = open + 1;
        if (close < 0) {
            spans.push({ text: lineText.slice(start), start });
            break;
        }
        spans.push({ text: lineText.slice(start, close), start });
        idx = close + 1;
    }
    return spans;
}
const ID_START = /[a-zA-Z_]/;
const ID_BODY = /[a-zA-Z0-9_.-]/;
function skipSpace(text, pos) {
    while (pos < text.length && /\s/.test(text[pos])) {
        pos += 1;
    }
    return pos;
}
function readIdentifier(text, pos) {
    pos = skipSpace(text, pos);
    if (pos >= text.length || !ID_START.test(text[pos])) {
        return { name: "", end: pos };
    }
    let end = pos + 1;
    while (end < text.length && ID_BODY.test(text[end])) {
        end += 1;
    }
    return { name: text.slice(pos, end), end };
}
function findExprEnd(text, openParen) {
    let depth = 0;
    let squote = false;
    let dquote = false;
    for (let i = openParen; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && !squote) {
            dquote = !dquote;
            continue;
        }
        if (ch === "'" && !dquote) {
            squote = !squote;
            continue;
        }
        if (squote || dquote) {
            continue;
        }
        if (ch === "(") {
            depth++;
        }
        else if (ch === ")") {
            depth--;
            if (depth === 0) {
                return i + 1;
            }
        }
    }
    return text.length;
}
/** Validate only sample-fetch subexpressions inside an ACL condition (not -m / eq / predefined ACLs). */
function validateAclConditions(lineText, schema) {
    const fetches = schema.sample_fetches ?? {};
    const converters = schema.sample_converters ?? {};
    const fetchNames = new Set(Object.keys(fetches));
    const convNames = new Set(Object.keys(converters));
    for (const name of schema.keyword_groups.sample_fetches ?? []) {
        fetchNames.add(name);
    }
    for (const name of schema.keyword_groups.sample_converters ?? []) {
        convNames.add(name);
    }
    const issues = [];
    for (const span of extractAclConditionSpans(lineText)) {
        const body = span.text;
        let pos = 0;
        while (pos < body.length) {
            pos = skipSpace(body, pos);
            if (pos >= body.length) {
                break;
            }
            if (body[pos] === "(") {
                const end = findExprEnd(body, pos);
                const slice = body.slice(pos, end);
                issues.push(...(0, sampleExpression_1.validateExpressionBody)(slice, span.start + pos, fetches, converters, fetchNames, convNames));
                pos = end;
                continue;
            }
            const idStart = skipSpace(body, pos);
            const id = readIdentifier(body, pos);
            if (!id.name) {
                pos += 1;
                continue;
            }
            const aclOnly = isAclOnlyCriterion(id.name, schema, fetchNames, fetches);
            const after = skipSpace(body, id.end);
            if (after < body.length && body[after] === "(") {
                const end = findExprEnd(body, after);
                if (aclOnly) {
                    pos = end;
                    continue;
                }
                const slice = body.slice(pos, end);
                issues.push(...(0, sampleExpression_1.validateExpressionBody)(slice, span.start + pos, fetches, converters, fetchNames, convNames));
                pos = end;
                continue;
            }
            const tail = skipSpace(body, id.end);
            if (tail >= body.length && fetchNames.has(id.name)) {
                issues.push(...(0, sampleExpression_1.validateExpressionBody)(id.name, span.start + idStart, fetches, converters, fetchNames, convNames));
            }
            pos = id.end;
        }
    }
    return issues;
}
//# sourceMappingURL=aclCondition.js.map