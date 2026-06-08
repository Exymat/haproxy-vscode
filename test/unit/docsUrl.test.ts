import { describe, expect, it } from "vitest";

import { configurationDocsUrl, docsAnchor } from "../../src/docsUrl";

describe("docsUrl", () => {
  it("builds chapter-keyword anchors for configuration keywords", () => {
    expect(docsAnchor("mode", "4.2")).toBe("4.2-mode");
    expect(docsAnchor("option httplog", "4.2")).toBe("4.2-option%20httplog");
  });

  it("builds bare keyword anchors for sample fetches and converters", () => {
    expect(docsAnchor("req.hdr_cnt")).toBe("req.hdr_cnt");
    expect(configurationDocsUrl("3.4", "req.hdr_cnt")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#req.hdr_cnt",
    );
  });

  it("builds configuration URLs with encoded anchors", () => {
    expect(configurationDocsUrl("3.4", "tune.vars.global-max-size", "3.2")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#3.2-tune.vars.global-max-size",
    );
  });
});
