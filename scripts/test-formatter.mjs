#!/usr/bin/env node
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const { formatConfig, splitLineAtComment, DEFAULT_FORMAT_OPTIONS } = require(
  join(extensionRoot, "out", "formatter.js")
);

function assertEqual(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `${name}: output mismatch\n--- expected ---\n${expected}\n--- actual ---\n${actual}`
    );
  }
}

const cases = [
  {
    name: "section headers left-aligned with normalized spacing",
    input: "     frontend         foo\n     mode             http",
    expected: "frontend foo\n    mode http",
  },
  {
    name: "doc 2.1 equivalent configs (second style)",
    input: [
      "         global#this is the global section",
      "     daemon#daemonize",
      "         frontend         foo",
      "     mode             http   # or tcp",
    ].join("\n"),
    expected: [
      "global #this is the global section",
      "    daemon #daemonize",
      "",
      "frontend foo",
      "    mode http # or tcp",
    ].join("\n"),
  },
  {
    name: "preserves quoted tokens and expressions",
    input: '    log-format "%{+Q}o %t %s %{-Q}r"',
    expected: '    log-format "%{+Q}o %t %s %{-Q}r"',
  },
  {
    name: "preserves strong quoting for regex",
    input: "    acl host_ok path_reg -i '^/api(/|$)'",
    expected: "    acl host_ok path_reg -i '^/api(/|$)'",
  },
  {
    name: "comment-only lines are left-aligned",
    input: "    # this is the public web frontend",
    expected: "# this is the public web frontend",
  },
  {
    name: "conditional block directives use section indent",
    input: ".if defined(HAPROXY_MWORKER)\n    daemon\n.endif",
    expected: "    .if defined(HAPROXY_MWORKER)\n    daemon\n    .endif",
  },
  {
    name: "tab indent style",
    input: "global\n    maxconn 100",
    options: { indentStyle: "tab", indentSize: 4, insertBlankLineBetweenSections: true },
    expected: "global\n\tmaxconn 100",
  },
  {
    name: "no blank line between sections when disabled",
    input: "global\n    daemon\ndefaults\n    mode http",
    options: { indentStyle: "spaces", indentSize: 4, insertBlankLineBetweenSections: false },
    expected: "global\n    daemon\ndefaults\n    mode http",
  },
  {
    name: "preserves trailing newline",
    input: "global\n    daemon\n",
    expected: "global\n    daemon\n",
  },
  {
    name: "preserves CRLF line endings",
    input: "global\r\n    daemon\r\n",
    expected: "global\r\n    daemon\r\n",
  },
  {
    name: "hash inside quotes is not a comment",
    input: '    http-request set-header X "#not-a-comment"',
    expected: '    http-request set-header X "#not-a-comment"',
  },
  {
    name: "2-space indent",
    input: "frontend web\n      bind :443",
    options: { indentStyle: "spaces", indentSize: 2, insertBlankLineBetweenSections: true },
    expected: "frontend web\n  bind :443",
  },
];

const splitCases = [
  {
    name: "unquoted hash starts comment",
    line: "mode http   # or tcp",
    code: "mode http",
    comment: "# or tcp",
  },
  {
    name: "quoted hash stays in code",
    line: 'set-var(txn.x) "a#b" # trailing',
    code: 'set-var(txn.x) "a#b"',
    comment: "# trailing",
  },
];

let passed = 0;

for (const testCase of splitCases) {
  const split = splitLineAtComment(testCase.line);
  if (split.code !== testCase.code || split.commentSuffix !== testCase.comment) {
    throw new Error(
      `${testCase.name}: split mismatch\n` +
        `  code: ${JSON.stringify(split.code)} (expected ${JSON.stringify(testCase.code)})\n` +
        `  comment: ${JSON.stringify(split.commentSuffix)} (expected ${JSON.stringify(testCase.comment)})`
    );
  }
  passed += 1;
}

for (const testCase of cases) {
  const options = testCase.options ?? DEFAULT_FORMAT_OPTIONS;
  const actual = formatConfig(testCase.input, options);
  assertEqual(testCase.name, actual, testCase.expected);
  passed += 1;
}

console.log(`formatter tests passed: ${passed}`);
