import { afterEach, describe, expect, it, vi } from "vitest";

import { formatHoverText } from "../../../src/hover";
import { exampleBlock, formatParameterExtra } from "../../../src/hover/markdown";
import { hoverMarkdown } from "./helpers";

describe("provideHover formatting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("documents log-format aliases and line-option hovers", () => {
    expect(hoverMarkdown("defaults\n    option httplog", 1, 11, "3.4")).toContain(
      "Valid in modes:",
    );
    expect(
      hoverMarkdown(
        'defaults\n    log-format "%{+Q}o %ci"',
        1,
        '    log-format "%{+Q}o %ci"'.indexOf("ci") + 1,
        "3.4",
      ),
    ).toContain("%ci");
    expect(
      hoverMarkdown(
        "frontend web\n    bind :443 ssl",
        1,
        "    bind :443 ssl".indexOf("ssl"),
        "3.4",
      ).toLowerCase(),
    ).toContain("ssl");
    expect(
      hoverMarkdown(
        "backend api\n    server s1 127.0.0.1:80 check",
        1,
        "    server s1 127.0.0.1:80 check".indexOf("check"),
        "3.4",
      ),
    ).toContain("Valid in modes:");
  });

  it("formats examples and markdown tables", () => {
    expect(exampleBlock({ title: "Minimal configuration", code: "global\n  grace 10s" })).toContain(
      "```haproxy",
    );
    expect(
      hoverMarkdown("global\n    grace 10s", 1, "    grace 10s".indexOf("grace"), "3.4"),
    ).toContain("**Example**");
    const formatted = formatHoverText(
      [
        "Prefix paragraph.",
        "",
        "Server state                   |         Interval used",
        "    ----------------------------------------+----------------------------------",
        '     UP 100% (non-transitional)             | "inter"',
        "    ----------------------------------------+----------------------------------",
      ].join("\n"),
    );
    expect(formatted).toContain("| Server state | Interval used |");
  });

  it("preserves blank lines and merges wrapped dconv rows", () => {
    const text = hoverMarkdown(
      "frontend web\n    bind :443 ssl alpn h2",
      1,
      "    bind :443 ssl alpn h2".indexOf("alpn"),
      "3.4",
    );
    expect(text).toContain("QUIC supports only h3 and hq-interop as ALPN.");

    const formatted = formatHoverText(
      [
        "Server state                   |         Interval used",
        "    ----------------------------------------+----------------------------------",
        '     Transitionally UP (going down "fall"), | "fastinter" if set,',
        '     Transitionally DOWN (going up "rise"), | "inter" otherwise.',
        "     or yet unchecked.                      |",
        "    ----------------------------------------+----------------------------------",
      ].join("\n"),
    );
    expect(formatted).toContain("fastinter");
    expect(formatted).toContain("inter");
  });

  it("covers invalid and partial table blocks", () => {
    expect(
      formatHoverText(
        ["Col A | Col B", "------+------", "x | y", "plain text between sections", "z | w"].join(
          "\n",
        ),
      ),
    ).toContain("| z | w |");
    expect(formatHoverText("intro\n\nonly | one\n------+------\n\noutro")).toContain("```text");
    expect(formatHoverText("State | Value\n------+------\nUP | inter\nDOWN | fast")).toContain(
      "| UP<br>DOWN | inter<br>fast |",
    );
    expect(formatHoverText("A | B\n------+------\nx | y\n-------+-------\nz | w")).toContain(
      "| z | w |",
    );
    expect(formatHoverText("Col A | Col B | Col C\n------+------+------\nx | y")).toContain(
      "| x | y |  |",
    );
  });

  it("handles non-structured blocks, diagram-like blocks, and short candidate tables", () => {
    expect(formatHoverText("plain text\nstill plain")).toBe("plain text\nstill plain");
    expect(formatHoverText("A | B\nx | y")).toContain("```text");
    expect(formatHoverText("------\n| node |\n------")).toContain("```text");
  });

  it("formats parameter labels with trimming and backtick escaping", () => {
    expect(formatParameterExtra("  user`name  ")).toBe("**Parameter:** `user\\`name`");
    expect(formatParameterExtra("   ")).toBe("**Parameter:** `argument`");
  });
});
