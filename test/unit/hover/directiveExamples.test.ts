import { describe, expect, it } from "vitest";

import { hoverMarkdown } from "./helpers";

describe("directive hover preserves examples", () => {
  it("shows structured examples after expanded http-request prose", () => {
    const line = "    http-request deny";
    const text = hoverMarkdown(`frontend web\n${line}`, 1, line.indexOf("http-request") + 3, "3.4");
    expect(text).toContain("http-request statement");
    expect(text).toContain("```haproxy");
    expect(text).toContain("http-request allow if nagios");
    expect(text).toContain("**Example**");
  });

  it("shows examples for grace after short description", () => {
    const line = "    grace 10s";
    const text = hoverMarkdown(`global\n${line}`, 1, line.indexOf("grace") + 2, "3.4");
    expect(text).toContain("grace 10s");
    expect(text).toContain("```haproxy");
    expect(text).toContain("**Example**");
  });

  it("shows examples for mode after arguments prose", () => {
    const line = "    mode http";
    const text = hoverMarkdown(`defaults d\n${line}`, 1, line.indexOf("mode") + 2, "3.4");
    expect(text.toLowerCase()).toContain("http");
    expect(text).toContain("```haproxy");
    expect(text).toContain("defaults http_instances");
  });

  it("keeps action examples when hovering parenthesized action tokens", () => {
    const line = "    http-request set-var(txn.hostheader) req.hdr(host)";
    const text = hoverMarkdown(`frontend web\n${line}`, 1, line.indexOf("set-var") + 2, "3.4");
    expect(text).toContain("set-var(<var-name>[,<cond>...]) <expr>");
    expect(text).toContain("```haproxy");
    expect(text).toContain("http-request set-var(req.my_var)");
  });
});
