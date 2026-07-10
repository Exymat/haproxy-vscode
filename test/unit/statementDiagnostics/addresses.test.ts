import { computeDiagnostics } from "../../../src/diagnostics";
import { parseDocument } from "../../helpers/parse";
import { statementDiagnostics } from "../../../src/statementDiagnostics";
import { createDocument } from "../../helpers/document";

import { lineDiag, bundle } from "./helpers";

describe("statementDiagnostics addresses", () => {
  it("validates log target addresses", () => {
    const diags = lineDiag("global\n    log not-an-address local0", 1);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("skips known log targets", () => {
    expect(lineDiag("global\n    log stdout local0", 1)).toEqual([]);
    expect(lineDiag("global\n    log @log local0", 1)).toEqual([]);
    expect(lineDiag("global\n    log ring@buffer local0", 1)).toEqual([]);
    expect(lineDiag("global\n    log /var/log/haproxy.log local0", 1)).toEqual([]);
  });

  it("validates source addresses", () => {
    const diags = lineDiag("defaults\n    source not-an-address", 1);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("validates tcp-check and http-check addr parameters", () => {
    const tcp = lineDiag("backend api\n    tcp-check connect addr bad", 1);
    expect(tcp.some((d) => d.code === "invalid-address")).toBe(true);
    const http = lineDiag("backend api\n    http-check connect addr bad", 1);
    expect(http.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("reports missing server arguments and reserved names", () => {
    const missing = lineDiag("backend api\n    server s1", 1);
    expect(missing.some((d) => d.code === "missing-argument")).toBe(true);

    const reserved = lineDiag("backend api\n    server check 127.0.0.1:80", 1);
    expect(reserved.some((d) => d.code === "reserved-name")).toBe(true);
  });

  it("reports unknown server parameters", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 notreal", 1);
    expect(diags.some((d) => d.code === "unknown-parameter")).toBe(true);
  });

  it("validates server option address values", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 source bad", 1);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("consumes nested source sub-options on server lines", () => {
    const diags = lineDiag(
      "backend api\n    server s1 127.0.0.1:80 check source 0.0.0.0 interface eth0",
      1,
    );
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("reports missing nested source sub-option argument", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 source 0.0.0.0 interface", 1);
    expect(diags.some((d) => d.code === "missing-argument")).toBe(true);
  });

  it("accepts source usesrc with address on server lines", () => {
    const diags = lineDiag("backend b6\n\t server s1 : source 0.0.0.0 usesrc localhost:16000", 1);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("validates usesrc address policy when nested under source", () => {
    const diags = lineDiag("backend b6\n\t server s1 : source 0.0.0.0 usesrc 0.0.0.1:+16002", 1);
    expect(diags.some((d) => d.code === "port-offset-not-permitted")).toBe(true);
    expect(diags.filter((d) => d.code === "missing-argument")).toHaveLength(0);
  });

  it("is invoked from computeDiagnostics for server lines", () => {
    const doc = createDocument("backend api\n    server s1 127.0.0.1:80 notreal");
    const diags = computeDiagnostics(doc, bundle.schema, {
      languageData: bundle.languageData,
    });
    expect(diags.some((d) => d.code === "unknown-parameter")).toBe(true);
  });

  it("returns empty for unrelated directives", () => {
    expect(lineDiag("defaults\n    mode http", 1)).toEqual([]);
    expect(lineDiag("global\n    daemon", 1)).toEqual([]);
  });

  it("validates bind addresses and unix sockets", () => {
    const bad = lineDiag("frontend web\n    bind bad-address:80", 1);
    expect(bad.some((d) => d.code === "invalid-address")).toBe(true);
    const unix = lineDiag("frontend web\n    bind /tmp/haproxy.sock", 1);
    expect(unix.filter((d) => d.code === "invalid-address")).toHaveLength(0);
  });

  it("consumes repeated bind addresses before scanning bind options", () => {
    const diags = lineDiag("frontend web\n    bind 192.168.1.22:80, :81, 192.168.1.23:82 ssl", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("skips placeholder server addresses", () => {
    const diags = lineDiag("backend api\n    server s1 /var/run/app.sock", 1);
    expect(diags.filter((d) => d.code === "invalid-address")).toHaveLength(0);
  });

  it("ignores numeric server options in nested scan", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 inter 2s", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("accepts server verify values", () => {
    const plain = lineDiag(
      "backend api\n    server s1 10.0.0.0:9006 check inter 1s verify none",
      1,
    );
    const ssl = lineDiag(
      "backend api\n    server s1 127.0.0.1:9001 check inter 1s ssl verify none",
      1,
    );
    expect(plain.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
    expect(ssl.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("accepts server cookie values", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80 cookie app01 check", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("returns empty for incomplete log and source lines", () => {
    expect(lineDiag("global\n    log", 1)).toEqual([]);
    expect(lineDiag("defaults\n    source", 1)).toEqual([]);
    expect(lineDiag("backend api\n    tcp-check connect", 1)).toEqual([]);
  });

  it("returns empty for lines without statement rules", () => {
    expect(lineDiag("global\n    # comment", 1)).toEqual([]);
  });

  it("skips empty nested option tokens", () => {
    const diags = lineDiag("backend api\n    server s1 127.0.0.1:80  inter 2s", 1);
    expect(diags.filter((d) => d.code === "unknown-parameter")).toHaveLength(0);
  });

  it("validates server addresses using kind fallback without address_policy", () => {
    const schema = structuredClone(bundle.schema);
    const serverRule = schema.statement_rules.find((r) => r.keyword === "server");
    const addressSlot = serverRule?.fixed_slots?.find((s) => s.role === "address");
    if (addressSlot) {
      delete addressSlot.address_policy;
    }
    const line = parseDocument(createDocument("backend api\n    server s1 bad-address:80"))[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);
  });

  it("validates bind addresses using kind fallback without address_policy", () => {
    const schema = structuredClone(bundle.schema);
    const bindRule = schema.statement_rules.find((r) => r.keyword === "bind");
    if (bindRule?.fixed_slots) {
      for (const slot of bindRule.fixed_slots) {
        delete slot.address_policy;
      }
    }
    const line = parseDocument(createDocument("frontend web\n    bind bad-address:80"))[1];
    const diags = statementDiagnostics(line, schema);
    expect(diags.some((d) => d.code === "invalid-address")).toBe(true);

    const unix = parseDocument(createDocument("frontend web\n    bind /tmp/haproxy.sock"))[1];
    expect(statementDiagnostics(unix, schema).filter((d) => d.code === "invalid-address")).toEqual(
      [],
    );
  });

  it("returns empty for rules without option groups", () => {
    const schema = structuredClone(bundle.schema);
    schema.statement_rules = [
      {
        keyword: "custom",
        kind: "directive",
        fixed_slots: [{ role: "name" }],
        nested_start_index: 2,
      },
    ];
    const doc = createDocument("backend api\n    custom name");
    const line = parseDocument(doc)[1];
    expect(statementDiagnostics(line, schema)).toEqual([]);
  });
});
