"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODIFIER_PREFIXES = exports.PREFIX_FAMILIES = exports.BIND_LEVEL_VALUES = exports.BALANCE_ALGORITHMS = exports.MODE_VALUES = exports.TCP_RULE_PHASES = exports.BIND_OPTIONS_WITH_VALUE = exports.SERVER_OPTIONS_WITH_VALUE = void 0;
exports.isWordToken = isWordToken;
exports.isDirectivePart = isDirectivePart;
exports.isNumberToken = isNumberToken;
exports.isLikelyValue = isLikelyValue;
exports.isAddressOrPathToken = isAddressOrPathToken;
exports.joinTokens = joinTokens;
exports.resolveLongestDirectiveMatch = resolveLongestDirectiveMatch;
exports.resolveAttemptedDirectiveSpan = resolveAttemptedDirectiveSpan;
exports.resolveSubcommandSpan = resolveSubcommandSpan;
exports.resolveDirectiveSpan = resolveDirectiveSpan;
exports.normalizeActionName = normalizeActionName;
exports.actionTokenIndex = actionTokenIndex;
exports.tcpPhaseIndex = tcpPhaseIndex;
exports.classifyValueToken = classifyValueToken;
exports.classifyArgumentToken = classifyArgumentToken;
exports.SERVER_OPTIONS_WITH_VALUE = new Set([
    "addr",
    "agent-addr",
    "agent-inter",
    "agent-port",
    "agent-send",
    "alpn",
    "ca-file",
    "check-alpn",
    "check-pool-conn-name",
    "check-proto",
    "check-sni",
    "ciphers",
    "ciphersuites",
    "client-sigalgs",
    "cookie",
    "crl-file",
    "crt",
    "curves",
    "downinter",
    "error-limit",
    "fastinter",
    "hash-key",
    "idle-ping",
    "init-addr",
    "inter",
    "log-bufsize",
    "log-proto",
    "max-reuse",
    "maxconn",
    "maxqueue",
    "minconn",
    "namespace",
    "observe",
    "on-error",
    "on-marked-down",
    "on-marked-up",
    "pool-conn-name",
    "pool-low-conn",
    "pool-max-conn",
    "pool-purge-delay",
    "port",
    "proto",
    "proxy-v2-options",
    "redir",
    "resolve-net",
    "resolve-opts",
    "resolve-prefer",
    "resolvers",
    "shard",
    "sigalgs",
    "sni",
    "slowstart",
    "ssl-max-ver",
    "ssl-min-ver",
    "verify",
    "verifyhost",
    "weight",
    "ws",
]);
exports.BIND_OPTIONS_WITH_VALUE = new Set([
    "alpn",
    "ca-file",
    "ca-ignore-err",
    "ca-sign-file",
    "ca-sign-pass",
    "ca-verify-file",
    "ciphers",
    "ciphersuites",
    "client-sigalgs",
    "crl-file",
    "crt",
    "crt-ignore-err",
    "crt-list",
    "curves",
    "default-crt",
    "gid",
    "group",
    "guid-prefix",
    "id",
    "idle-ping",
    "interface",
    "label",
    "level",
    "maxconn",
    "mode",
    "mss",
    "name",
    "namespace",
    "nbconn",
    "nice",
    "npn",
    "process",
    "proto",
    "quic-cc-algo",
    "severity-output",
    "shards",
    "sigalgs",
    "ssl-max-ver",
    "ssl-min-ver",
    "thread",
    "tls-ticket-keys",
    "uid",
    "user",
    "verify",
]);
exports.TCP_RULE_PHASES = new Set(["connection", "session", "content", "inspect-delay"]);
exports.MODE_VALUES = new Set(["http", "tcp", "log", "health"]);
exports.BALANCE_ALGORITHMS = new Set([
    "roundrobin",
    "leastconn",
    "first",
    "source",
    "uri",
    "url_param",
    "hdr",
    "random",
    "static-rr",
    "hash",
]);
exports.BIND_LEVEL_VALUES = new Set(["user", "operator", "admin"]);
exports.PREFIX_FAMILIES = ["stats", "timeout", "tcp-check", "http-check", "capture", "tcp-request", "tcp-response"];
exports.MODIFIER_PREFIXES = new Set(["no", "default"]);
function isWordToken(token) {
    return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token);
}
function isDirectivePart(token) {
    return /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(token);
}
function isNumberToken(token) {
    return /^[0-9]+(?:\.[0-9]+)?(?:[kmgt]?s|ms|m|h|d|k|%)?$/i.test(token);
}
function isLikelyValue(token) {
    if (!token) {
        return true;
    }
    if (token.startsWith("<") && token.endsWith(">")) {
        return true;
    }
    if (token.startsWith('"') || token.startsWith("'")) {
        return true;
    }
    if (token.startsWith("{") || token.startsWith("%[") || token.startsWith("(")) {
        return true;
    }
    if (/^[0-9]/.test(token)) {
        return true;
    }
    if (token.includes(":") || token.includes("/") || token.includes("=")) {
        return true;
    }
    if (token.includes(".") && !isDirectivePart(token)) {
        return true;
    }
    if (token === "if" || token === "unless") {
        return true;
    }
    return false;
}
function isAddressOrPathToken(token) {
    if (token.startsWith('"') || token.startsWith("'")) {
        return true;
    }
    return token.includes(":") || token.includes("/") || token.includes(".") || token.startsWith(":");
}
function joinTokens(tokens, start, end) {
    return tokens
        .slice(start, end + 1)
        .map((t) => t.text.toLowerCase())
        .join(" ");
}
function resolveLongestDirectiveMatch(line, allowed, maxParts = 4, noPrefixKeywords) {
    const tokens = line.tokens;
    if (tokens.length === 0) {
        return { start: 0, end: -1, keyword: "", matched: false };
    }
    if (noPrefixKeywords &&
        tokens.length >= 2 &&
        exports.MODIFIER_PREFIXES.has(tokens[0].text.toLowerCase())) {
        const inner = resolveLongestDirectiveMatch({ ...line, tokens: tokens.slice(1) }, allowed, maxParts, undefined);
        if (inner.matched && noPrefixKeywords.has(inner.keyword)) {
            return {
                start: 0,
                end: inner.end + 1,
                keyword: inner.keyword,
                matched: true,
            };
        }
    }
    const limit = Math.min(tokens.length, maxParts);
    for (let end = limit - 1; end >= 0; end -= 1) {
        const keyword = joinTokens(tokens, 0, end);
        const hyphen = tokens
            .slice(0, end + 1)
            .map((t) => t.text.toLowerCase())
            .join("-");
        if (allowed.has(keyword) || (end === 1 && allowed.has(hyphen))) {
            return { start: 0, end, keyword: allowed.has(keyword) ? keyword : hyphen, matched: true };
        }
    }
    return resolveAttemptedDirectiveSpan(line, maxParts);
}
function resolveAttemptedDirectiveSpan(line, maxParts = 4) {
    const tokens = line.tokens;
    if (tokens.length === 0) {
        return { start: 0, end: -1, keyword: "", matched: false };
    }
    let end = 0;
    while (end < tokens.length && end < maxParts) {
        const text = tokens[end].text;
        if (end > 0 && isLikelyValue(text)) {
            break;
        }
        if (!isDirectivePart(text)) {
            break;
        }
        end += 1;
    }
    if (end === 0) {
        end = 1;
    }
    else {
        end -= 1;
    }
    return {
        start: 0,
        end,
        keyword: joinTokens(tokens, 0, end),
        matched: false,
    };
}
function resolveSubcommandSpan(line, allowed, prefix) {
    const prefixLower = prefix.toLowerCase();
    if (line.tokens[0]?.text.toLowerCase() !== prefixLower || line.tokens.length < 2) {
        return null;
    }
    const subcommands = new Set();
    const needle = `${prefixLower} `;
    for (const keyword of allowed) {
        if (keyword.startsWith(needle)) {
            subcommands.add(keyword.slice(needle.length));
        }
    }
    if (subcommands.size === 0) {
        return null;
    }
    for (let end = Math.min(line.tokens.length - 1, 3); end >= 1; end -= 1) {
        const sub = joinTokens(line.tokens, 1, end);
        if (subcommands.has(sub)) {
            return { start: 1, end, subcommand: sub, matched: true };
        }
    }
    let end = 1;
    while (end < line.tokens.length && end < 4 && isDirectivePart(line.tokens[end].text)) {
        end += 1;
    }
    end = Math.max(1, end - 1);
    return {
        start: 1,
        end,
        subcommand: joinTokens(line.tokens, 1, end),
        matched: false,
    };
}
function resolveDirectiveSpan(line, allowed) {
    const match = resolveLongestDirectiveMatch(line, allowed);
    return { start: match.start, end: match.end };
}
/** Rule action name from a config token (e.g. set-var(txn.path) -> set-var). */
function normalizeActionName(token) {
    const lower = token.toLowerCase().replace(/\*$/, "");
    const paren = lower.indexOf("(");
    if (paren > 0 && lower.endsWith(")")) {
        return lower.slice(0, paren);
    }
    return lower;
}
function actionTokenIndex(line) {
    const tokens = line.tokens;
    if (tokens.length < 2) {
        return null;
    }
    const t0 = tokens[0].text.toLowerCase();
    if (t0 === "http-request" || t0 === "http-response" || t0 === "http-after-response") {
        return 1;
    }
    if (t0 === "tcp-request" || t0 === "tcp-response") {
        if (tokens.length >= 3) {
            const t1 = tokens[1].text.toLowerCase();
            if (t1 === "connection" || t1 === "session" || t1 === "content") {
                return 2;
            }
        }
        return 1;
    }
    return null;
}
function tcpPhaseIndex(line) {
    const t0 = line.tokens[0]?.text.toLowerCase();
    if (t0 !== "tcp-request" && t0 !== "tcp-response") {
        return null;
    }
    if (line.tokens.length >= 2) {
        const t1 = line.tokens[1].text.toLowerCase();
        if (exports.TCP_RULE_PHASES.has(t1)) {
            return 1;
        }
    }
    return null;
}
function classifyValueToken(token, options) {
    const lower = token.text.toLowerCase();
    if (lower === "if" || lower === "unless") {
        return "operator";
    }
    if (isNumberToken(token.text)) {
        return "number";
    }
    if (isAddressOrPathToken(token.text)) {
        return "string";
    }
    if (exports.MODE_VALUES.has(lower) || exports.BALANCE_ALGORITHMS.has(lower) || exports.BIND_LEVEL_VALUES.has(lower)) {
        return "option";
    }
    if (options?.has(lower)) {
        return "option";
    }
    return null;
}
function classifyArgumentToken(token, options, bindOptions, serverOptions) {
    const classified = classifyValueToken(token, options);
    if (classified) {
        return classified;
    }
    const lower = token.text.toLowerCase().replace(/\*$/, "");
    if (bindOptions.has(lower) || serverOptions.has(lower)) {
        return "property";
    }
    if (isWordToken(lower)) {
        return "string";
    }
    return "string";
}
//# sourceMappingURL=tokenUtils.js.map