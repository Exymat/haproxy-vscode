import { describe, expect, it } from "vitest";

import { parseDocument } from "../../../helpers/parse";
import { collectEnvironmentVariableSites } from "../../../../src/symbolIndex/collectors/environmentVars";
import type { SymbolSite } from "../../../../src/symbolIndex/types";

import { doc } from "../helpers";

describe("environmentVars collector", () => {
  it("collects environment variable references from quoted expansions", () => {
    const parsed = parseDocument(
      doc('global\n    setenv FOO bar\n    log "${FOO-default}:514" local0'),
      "3.4",
    );
    const references: SymbolSite[] = [];
    collectEnvironmentVariableSites(parsed[2], references);
    expect(references).toEqual([
      expect.objectContaining({
        kind: "environment-variable",
        name: "FOO",
        role: "reference",
      }),
    ]);
  });

  it("collects multiple environment variable references on one line", () => {
    const parsed = parseDocument(doc('global\n    user "$HAPROXY_USER:$HAPROXY_GROUP"'), "3.4");
    const references: SymbolSite[] = [];
    collectEnvironmentVariableSites(parsed[1], references);
    expect(references.map((site) => site.name)).toEqual(["HAPROXY_USER", "HAPROXY_GROUP"]);
  });

  it("skips lines with no environment expansions", () => {
    const parsed = parseDocument(doc("global\n    maxconn 8192"), "3.4");
    const references: SymbolSite[] = [];
    collectEnvironmentVariableSites(parsed[1], references);
    expect(references).toEqual([]);
  });

  it("collects env() sample-fetch references", () => {
    const parsed = parseDocument(
      doc("frontend web\n    http-request deny if { env(FOO) -m found }"),
      "3.4",
    );
    const references: SymbolSite[] = [];
    collectEnvironmentVariableSites(parsed[1], references);
    expect(references).toEqual([
      expect.objectContaining({
        kind: "environment-variable",
        name: "FOO",
        role: "reference",
      }),
    ]);
  });
});
