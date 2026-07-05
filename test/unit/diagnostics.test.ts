import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_VERSION,
  defaultSchema,
  diagnosticOptions,
  runDiagnosticCase,
  schemas,
  type DiagnosticExpectations,
} from "../helpers/diagnostics";
import { formatDiagnosticCode } from "../helpers/diagnosticFormat";
import { createDocument, updateDocument } from "../helpers/document";
import { computeDiagnostics } from "../../src/diagnostics";

const fixturesDir = join(__dirname, "..", "fixtures");

const validSnippet = readFileSync(join(fixturesDir, "basic-check-snippet.cfg"), "utf-8");
const hapeeAclSnippet = readFileSync(join(fixturesDir, "hapee-acl-snippet.cfg"), "utf-8");
const invalidFixture = readFileSync(join(fixturesDir, "diagnostics-invalid.cfg"), "utf-8");

const cases: Array<{
  name: string;
  content: string;
  expectations: DiagnosticExpectations;
  schema?: (typeof schemas)[keyof typeof schemas];
  version?: typeof DEFAULT_VERSION | "3.4";
}> = [
  { name: "valid snippet", content: validSnippet, expectations: { total: 0 } },
  {
    name: "hapee acl snippet",
    content: hapeeAclSnippet,
    expectations: { total: 1, counts: { "missing-reference": 1 } },
  },
  {
    name: "bind in global",
    content: "frontend x\n\texternal-check\n",
    expectations: { total: 1, counts: { "wrong-section": 1 } },
  },
  {
    name: "unknown option",
    content: "defaults\n\toption notreal\n",
    expectations: { total: 1, counts: { "unknown-option": 1 } },
  },
  {
    name: "unknown mode",
    content: "listen x\n\tmode ftp\n",
    expectations: { total: 1, counts: { "unknown-value": 1 } },
  },
  {
    name: "mode haterm valid on 3.4",
    content: "frontend x\n\tmode haterm\n",
    expectations: { total: 0, counts: {} },
    schema: schemas["3.4"],
  },
  {
    name: "mode haterm unknown on 3.2",
    content: "frontend x\n\tmode haterm\n",
    expectations: { total: 1, counts: { "unknown-value": 1 } },
    schema: schemas["3.2"],
  },
  {
    name: "mode extra argument",
    content: "listen x\n\tmode http this-is-not-valid\n",
    expectations: { total: 1, counts: { "extra-argument": 1 } },
  },
  {
    name: "balance unknown algorithm",
    content: "backend x\n\tbalance not-an-alg\n",
    expectations: { total: 1, counts: { "unknown-value": 1 } },
  },
  {
    name: "unknown acl criterion",
    content: "frontend x\n\tbind :80\n\tacl bad notreal\n",
    expectations: { total: 1, counts: { "unknown-criterion": 1 } },
  },
  {
    name: "unknown tcp-check step",
    content: "backend x\n\ttcp-check notreal\n",
    expectations: { total: 1, counts: { "unknown-keyword": 1 } },
  },
  {
    name: "unknown http-request action",
    content: "frontend x\n\tbind :80\n\thttp-request notreal if { always_true }\n",
    expectations: { total: 1, counts: { "unknown-action": 1 } },
  },
  {
    name: "no log on invertible keyword",
    content: "frontend x\n\tbind :80\n\tno log\n",
    expectations: { total: 0 },
  },
  {
    name: "no option on invertible option",
    content: "defaults\n\tno option redispatch\n",
    expectations: { total: 0 },
  },
  {
    name: "set-var with inline variable name",
    content: "backend x\n\thttp-request set-var(txn.rwtpath) path\n",
    expectations: { total: 0 },
  },
  {
    name: "set-var-fmt with inline variable name",
    content: "backend x\n\thttp-request set-var-fmt(txn.host) %H\n",
    expectations: { total: 0 },
  },
  {
    name: "unset-var with inline variable name",
    content: "backend x\n\thttp-request unset-var(txn.rwtpath)\n",
    expectations: { total: 0 },
  },
  {
    name: "server invalid address blah",
    content: "backend ssh\n\tserver check blah 127.0.0.1:22 check inter 1s\n",
    expectations: { total: 2, counts: { "invalid-address": 1, "reserved-name": 1 } },
  },
  {
    name: "server malformed ipv4",
    content: "backend ssh\n\tserver blah 127.0.0.1.2.8.7:22 check inter 1s\n",
    expectations: { total: 1, counts: { "invalid-address": 1 } },
  },
  {
    name: "server reserved name check",
    content: "backend ssh\n\tserver check 127.0.0.1:22\n",
    expectations: { total: 1, counts: { "reserved-name": 1 } },
  },
  {
    name: "server colon address with source",
    content: "backend b5\n\tserver s1 : source 127.0.0.1:15001\n",
    expectations: { total: 0 },
  },
  {
    name: "invalid fixture bundle",
    content: invalidFixture,
    expectations: {
      total: 6,
      counts: {
        "unknown-option": 1,
        "unknown-value": 1,
        "unknown-keyword": 1,
        "unknown-criterion": 1,
        "unknown-action": 1,
        "wrong-section": 1,
      },
    },
  },
  {
    name: "deprecated keyword master-worker",
    content: "global\n\tmaster-worker\n",
    expectations: { total: 1, counts: { "deprecated-keyword": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "deprecated option transparent",
    content: "frontend x\n\toption transparent\n",
    expectations: { total: 1, counts: { "deprecated-keyword": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "deprecated http-request set-mark",
    content: "frontend x\n\thttp-request set-mark 1\n",
    expectations: { total: 1, counts: { "deprecated-action": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "deprecated acl sample fetch alias hdr_cnt",
    content: "frontend x\n\tacl bad hdr_cnt(host) eq 1\n",
    expectations: { total: 1, counts: { "deprecated-sample": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "deprecated sample fetch inside inline expression",
    content: "frontend x\n\thttp-request set-header X-Test %[hdr_cnt(host)]\n",
    expectations: { total: 1, counts: { "deprecated-sample": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "expose-deprecated-directives suppresses deprecated warnings",
    content: "global\n\texpose-deprecated-directives\n\tmaster-worker\n",
    expectations: { total: 0 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "named defaults required for acl in anonymous defaults",
    content: "defaults\n\tacl is_admin path_beg /admin\n",
    expectations: { total: 1, counts: { "named-defaults-required": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "named defaults required for http-request in anonymous defaults",
    content: "defaults\n\thttp-request deny if TRUE\n",
    expectations: { total: 1, counts: { "named-defaults-required": 1 }, severity: 1 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "named defaults keyword allowed in named defaults section",
    content: "defaults my-defaults\n\thttp-request deny if TRUE\n",
    expectations: { total: 0 },
    schema: schemas["3.4"],
    version: "3.4",
  },
  {
    name: "maxconn allowed in anonymous defaults",
    content: "defaults\n\tmaxconn 1000\n",
    expectations: { total: 0 },
    schema: schemas["3.4"],
    version: "3.4",
  },
];

describe("diagnostics", () => {
  it.each(cases)("$name", ({ name, content, expectations, schema, version }) => {
    runDiagnosticCase(name, content, expectations, schema, version ?? DEFAULT_VERSION);
  });

  it("preserves diagnostics results across incremental edits", () => {
    const base = "frontend web\n\tbind :80\n\toption notreal\n";
    const edited = "frontend web\n\tbind :81\n\toption notreal\n";
    const doc = createDocument(base);

    computeDiagnostics(doc, defaultSchema, diagnosticOptions(DEFAULT_VERSION));
    updateDocument(doc, edited);

    const incremental = computeDiagnostics(doc, defaultSchema, diagnosticOptions(DEFAULT_VERSION));
    const fresh = computeDiagnostics(
      createDocument(edited),
      defaultSchema,
      diagnosticOptions(DEFAULT_VERSION),
    );

    expect(incremental).toEqual(fresh);
  });

  it("reports missing references without unused-symbol diagnostics", () => {
    const doc = createDocument("frontend web\n    use_backend missing\n    bind :80");
    const diags = computeDiagnostics(doc, defaultSchema, {
      ...diagnosticOptions(DEFAULT_VERSION),
      unusedSymbols: false,
      missingReferences: true,
    });
    expect(diags.some((diag) => diag.code === "missing-reference")).toBe(true);
    expect(diags.some((diag) => formatDiagnosticCode(diag.code).startsWith("unused-"))).toBe(false);
  });

  it("skips missing-reference diagnostics when disabled", () => {
    const doc = createDocument("frontend web\n    use_backend missing\n    bind :80");
    const diags = computeDiagnostics(doc, defaultSchema, {
      ...diagnosticOptions(DEFAULT_VERSION),
      unusedSymbols: true,
      missingReferences: false,
    });
    expect(diags.some((diag) => diag.code === "missing-reference")).toBe(false);
  });

  it("reuses document-level symbol diagnostics when the symbol index is unchanged", () => {
    const doc = createDocument("frontend web\n    use_backend missing\n    bind :80");
    computeDiagnostics(doc, defaultSchema, {
      ...diagnosticOptions(DEFAULT_VERSION),
      unusedSymbols: true,
      missingReferences: true,
    });
    const second = computeDiagnostics(doc, defaultSchema, {
      ...diagnosticOptions(DEFAULT_VERSION),
      unusedSymbols: true,
      missingReferences: true,
    });
    expect(second.some((diag) => diag.code === "missing-reference")).toBe(true);
  });
});
