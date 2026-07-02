import { afterEach, describe, expect, it, vi } from "vitest";

import * as documentContext from "../../../src/documentContext";
import { provideHover } from "../../../src/hover";
import { createDocument } from "../../helpers/document";
import { bundles, hoverMarkdown, hoverText } from "./helpers";

describe("provideHover keyword docs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("documents actions, acl criteria, and sample fetches", () => {
    expect(
      hoverMarkdown(
        "frontend web\n    http-request deny",
        1,
        "    http-request deny".indexOf("deny"),
        "3.4",
      ),
    ).toContain("immediately rejects");
    expect(
      hoverMarkdown(
        "frontend web\n    http-request track-sc1 src",
        1,
        "    http-request track-sc1 src".indexOf("track-sc1"),
        "3.4",
      ),
    ).toContain("sticky counters");
    expect(
      hoverMarkdown(
        "frontend web\n    acl test path -m beg /",
        1,
        "    acl test path".indexOf("path"),
        "3.4",
      ).toLowerCase(),
    ).toContain("path");
    expect(
      hoverMarkdown(
        "frontend web\n    acl test req.hdr(host) -m found",
        1,
        "    acl test req.hdr(host)".indexOf("req.hdr") + 2,
        "3.4",
      ).toLowerCase(),
    ).toContain("req.hdr");
    expect(
      hoverMarkdown(
        "frontend web\n    http-request set-var(txn.hostheader) req.hdr(host)",
        1,
        "    http-request set-var(txn.hostheader) req.hdr(host)".indexOf("req.hdr") + 2,
        "3.4",
      ).toLowerCase(),
    ).toContain("req.hdr");
    expect(
      hoverMarkdown(
        "frontend web\n    http-request set-header X-Test %[req.hdr(host)]",
        1,
        "    http-request set-header X-Test %[req.hdr(host)]".indexOf("req.hdr") + 2,
        "3.4",
      ).toLowerCase(),
    ).toContain("returns");
  });

  it("documents acl flags and match methods", () => {
    expect(
      hoverMarkdown(
        "frontend web\n    acl test path -m beg /",
        1,
        "    acl test path -m".indexOf("-m"),
        "3.4",
      ),
    ).toContain("specific pattern matching method");
    expect(
      hoverMarkdown(
        "frontend web\n    acl test path -M -f map.lst",
        1,
        "    acl test path -M".indexOf("-M"),
        "3.4",
      ),
    ).toContain("load the file pointed by -f like a map");
    expect(
      hoverMarkdown(
        "frontend web\n    http-request set-header Host unless { req.hdr(Host) -m found }",
        1,
        "    http-request set-header Host unless { req.hdr(Host) -m found }".indexOf("found") + 1,
        "3.4",
      ).toLowerCase(),
    ).toContain("found");
  });

  it("documents directives, arguments, and section-specific bind forms", () => {
    expect(hoverMarkdown("defaults\n    mode", 1, 7, "3.4").toLowerCase()).toContain("mode");
    expect(
      hoverMarkdown(
        "defaults\n    mode http",
        1,
        "    mode http".indexOf("http"),
        "3.4",
      ).toLowerCase(),
    ).toContain("http");
    expect(
      hoverMarkdown(
        "backend api\n    http-check send meth GET",
        1,
        "    http-check send meth GET".indexOf("meth"),
        "3.4",
      ),
    ).toContain("**Directive:** http-check send");
    expect(
      hoverMarkdown(
        "backend api\n    balance random(5)",
        1,
        "    balance random(5)".indexOf("random"),
        "3.4",
      ),
    ).toContain("random(<draws>)");
    expect(hoverMarkdown("frontend web\n    bind", 1, "    bind".indexOf("bind"), "3.4")).toContain(
      "#4.2-bind",
    );
    expect(
      hoverMarkdown("peers cluster\n    bind", 1, "    bind".indexOf("bind"), "3.4"),
    ).toContain("#11.2-bind");
    expect(
      hoverMarkdown(
        "frontend web\n    filter cache maintenance_cache",
        1,
        "    filter cache maintenance_cache".indexOf("cache"),
        "3.0",
      ),
    ).toContain("cache uses a filter");
  });

  it("documents directive forms, parameters, and argument values", () => {
    const bindLine = "frontend web\n    bind :80 ssl";
    expect(hoverMarkdown(bindLine, 1, "    bind :80 ssl".indexOf("bind"), "3.4")).toContain(
      "Forms:",
    );
    expect(
      hoverMarkdown(
        "backend api\n    server s1 127.0.0.1:80 check",
        1,
        "    server s1 127.0.0.1:80 check".indexOf("127.0.0.1:80") + 1,
        "3.4",
      ),
    ).toContain("**Parameter:**");
  });

  it("rejects dashed expression sample tokens", () => {
    const bundle = bundles["3.4"];
    const doc = createDocument("frontend web\n    http-request set-header X-Test %[-src]");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [{ text: "-src", start: 39, end: 43 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    http-request set-header X-Test %[-src]",
      tokenIndex: 0,
      token: { text: "-src", start: 39, end: 43 },
      kind: "expression-fetch",
      prefix: "    http-request set-header X-Test %[-src]",
    });
    expect(
      provideHover(doc, { line: 1, character: 40 } as never, bundle.languageData, bundle.schema),
    ).toBeNull();
  });

  it("covers conditional directives and whitespace-only sample candidates", () => {
    const doc = createDocument("global\n    .if { always_true }");
    const bundle = bundles["3.4"];
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "global",
        tokens: [{ text: ".if", start: 4, end: 7 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    .if { always_true }",
      tokenIndex: 0,
      token: { text: ".if", start: 4, end: 7 },
      kind: "directive",
      prefix: "    .if",
    });
    const conditionalHover = provideHover(
      doc,
      { line: 1, character: 5 } as never,
      bundle.languageData,
      bundle.schema,
    );
    expect(conditionalHover).not.toBeNull();
    if (!conditionalHover) {
      throw new Error("expected hover");
    }
    expect(hoverText(conditionalHover)).toContain(".if");

    const sampleDoc = createDocument("frontend web\n    http-request set-header X-Test %[   ]");
    vi.spyOn(documentContext, "getDocumentContext").mockReturnValue({
      line: {
        line: 1,
        section: "frontend",
        tokens: [{ text: "   ", start: 40, end: 43 }],
        isSectionHeader: false,
        anonymousDefaults: false,
      },
      lineText: "    http-request set-header X-Test %[   ]",
      tokenIndex: 0,
      token: { text: "   ", start: 40, end: 43 },
      kind: "expression-fetch",
      prefix: "    http-request set-header X-Test %[   ]",
    });
    expect(
      provideHover(
        sampleDoc,
        { line: 1, character: 41 } as never,
        bundle.languageData,
        bundle.schema,
      ),
    ).toBeNull();
  });
});
