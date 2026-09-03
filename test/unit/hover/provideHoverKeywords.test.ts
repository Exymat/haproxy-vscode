import { afterEach, describe, expect, it, vi } from "vitest";

import * as documentContext from "../../../src/parser/documentContext";
import { provideHover } from "../../../src/hover";
import { createDocument } from "../../helpers/document";
import { bundles, hoverMarkdown, hoverText } from "./helpers";
import { loadHapeeBundle } from "../../helpers/schema";

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
    expect(
      hoverMarkdown(
        "frontend web\n    acl test src -m ip 10.0.0.0/8",
        1,
        "    acl test src -m ip".indexOf(" ip") + 1,
        "3.4",
      ),
    ).toContain("-m ip");
    const domHover = hoverMarkdown(
      "frontend web\n    acl test hdr(host) -m dom example.com",
      1,
      "    acl test hdr(host) -m dom".indexOf(" dom") + 1,
      "3.4",
    );
    expect(domHover).toContain("domain match");
    expect(domHover).not.toContain("jsess_present");
    expect(domHover).not.toContain("Input sample type");
    expect(
      hoverMarkdown(
        "frontend web\n    acl test hdr(host) -- example.com",
        1,
        "    acl test hdr(host) --".indexOf("--"),
        "3.4",
      ),
    ).not.toContain("valid-ua");
  });

  it("documents predefined ACLs and integer operators in conditions", () => {
    const httpHover = hoverMarkdown(
      "frontend web\n    use_backend static if HTTP",
      1,
      "    use_backend static if HTTP".indexOf("HTTP"),
      "3.4",
    );
    expect(httpHover).toContain("req.proto_http");
    expect(httpHover).not.toContain("Switch to a specific backend");
    expect(
      hoverMarkdown(
        "frontend web\n    http-request deny unless HTTP",
        1,
        "    http-request deny unless HTTP".indexOf("HTTP"),
        "3.4",
      ),
    ).toContain("req.proto_http");
    expect(
      hoverMarkdown(
        "frontend web\n    http-request deny if { status ge 500 }",
        1,
        "    http-request deny if { status ge 500 }".indexOf(" ge") + 1,
        "3.4",
      ),
    ).toContain("greater than or equal");
  });

  it("documents stick-table key types instead of ACL -m ip", () => {
    const stickTableIp = "backend app\n    stick-table type ip size 1m expire 60m";
    const ipCol = "    stick-table type ip".indexOf(" ip") + 1;
    const community = hoverMarkdown(stickTableIp, 1, ipCol, "3.0");
    expect(community.toLowerCase()).toContain("ipv4");
    expect(community).not.toContain("-m ip");
    const modern = hoverMarkdown(stickTableIp, 1, ipCol, "3.4");
    expect(modern.toLowerCase()).toContain("avoided");
    expect(modern.toLowerCase()).toContain("ipv4");
    expect(modern).not.toContain("-m ip");
    const hapee = loadHapeeBundle("3.2");
    const hapeeDoc = createDocument(stickTableIp);
    const hapeeHover = provideHover(
      hapeeDoc,
      { line: 1, character: ipCol } as never,
      hapee.languageData,
      hapee.schema,
    );
    expect(hapeeHover).not.toBeNull();
    if (hapeeHover === null) {
      throw new Error("expected HAPEE stick-table ip hover");
    }
    const hapeeText = hoverText(hapeeHover);
    expect(hapeeText.toLowerCase()).toContain("ipv4");
    expect(hapeeText).not.toContain("-m ip");
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
