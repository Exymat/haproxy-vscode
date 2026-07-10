import { describe, expect, it } from "vitest";

import {
  formatConfig,
  splitLineAtComment,
  DEFAULT_FORMAT_OPTIONS,
  type FormatOptions,
} from "../../src/formatter";
import { sectionHeaderSet } from "../../src/schema";
import { loadSchema } from "../helpers/schema";

describe("formatter", () => {
  const cases: Array<{
    name: string;
    input: string;
    expected: string;
    options?: FormatOptions;
  }> = [
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
        "    global#this is the global section",
        "    daemon#daemonize",
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
      options: { indentStyle: "tab" as const, indentSize: 4, insertBlankLineBetweenSections: true },
      expected: "global\n\tmaxconn 100",
    },
    {
      name: "no blank line between sections when disabled",
      input: "global\n    daemon\ndefaults\n    mode http",
      options: {
        indentStyle: "spaces" as const,
        indentSize: 4,
        insertBlankLineBetweenSections: false,
      },
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
      name: "unquoted hash inside token is not a comment",
      input: "    set-var(txn.slug) a#b",
      expected: "    set-var(txn.slug) a#b",
    },
    {
      name: "hash joined to section name is not a comment",
      input: "     global#comment\n     daemon",
      expected: "    global#comment\n    daemon",
    },
    {
      name: "2-space indent",
      input: "frontend web\n      bind :443",
      options: {
        indentStyle: "spaces" as const,
        indentSize: 2,
        insertBlankLineBetweenSections: true,
      },
      expected: "frontend web\n  bind :443",
    },
    {
      name: "collapses multiple blank lines between sections",
      input: "global\n    maxconn 100\n\n\n\n\ndefaults\n    mode http",
      expected: "global\n    maxconn 100\n\ndefaults\n    mode http",
    },
    {
      name: "removes trailing blank lines at end of file",
      input: "global\n    maxconn 100\n\n\n",
      expected: "global\n    maxconn 100\n",
    },
    {
      name: "preserves blank lines within a section",
      input: "frontend web\n    bind :80\n\n    default_backend www",
      expected: "frontend web\n    bind :80\n\n    default_backend www",
    },
  ];

  it.each(cases)("$name", ({ input, expected, options }) => {
    expect(formatConfig(input, options ?? DEFAULT_FORMAT_OPTIONS)).toBe(expected);
  });

  it.each([
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
    {
      name: "unquoted hash inside token stays in code",
      line: "set-var(txn.x) a#b",
      code: "set-var(txn.x) a#b",
      comment: null,
    },
    {
      name: "section-like token with hash stays in code",
      line: "global#comment",
      code: "global#comment",
      comment: null,
    },
    {
      name: "whitespace-started hash starts comment",
      line: "mode http   # or tcp",
      code: "mode http",
      comment: "# or tcp",
    },
    {
      name: "comment-only line",
      line: "# comment only",
      code: "",
      comment: "# comment only",
    },
    {
      name: "leading-whitespace comment-only line",
      line: "    # comment only",
      code: "",
      comment: "# comment only",
    },
  ] as const satisfies ReadonlyArray<{
    name: string;
    line: string;
    code: string;
    comment: string | null;
  }>)("splitLineAtComment: $name", ({ line, code, comment }) => {
    const split = splitLineAtComment(line);
    expect(split.code).toBe(code);
    expect(split.commentSuffix).toBe(comment);
  });

  it("formats comment-only lines without indentation", () => {
    expect(formatConfig("# comment only")).toBe("# comment only");
  });

  it("handles inputs with no non-empty lines", () => {
    expect(formatConfig("\n\n")).toBe("\n\n");
  });

  it("handles an empty file", () => {
    expect(formatConfig("")).toBe("");
  });

  it("treats fcgi-app as a section header when schema headers are provided", () => {
    const schema = loadSchema("3.4");
    const input = "    fcgi-app myapp\n        mode http";
    const withSchema = formatConfig(input, {
      ...DEFAULT_FORMAT_OPTIONS,
      sectionHeaders: sectionHeaderSet(schema),
    });
    const withDefaults = formatConfig(input, DEFAULT_FORMAT_OPTIONS);
    expect(withSchema).toBe("fcgi-app myapp\n    mode http");
    expect(withDefaults).toBe("    fcgi-app myapp\n    mode http");
    expect(withSchema).not.toBe(withDefaults);
  });
});
