import * as assert from "node:assert";
import * as vscode from "vscode";

import { formatDiagnosticCode } from "../../helpers/diagnosticFormat";
import {
  assertDiagnosticCounts,
  clearHaproxySetting,
  completionLabelsAt,
  definitionLocationsAt,
  ensureHaproxyVersion,
  filterDiagnostics,
  formatDocumentContent,
  hoverTextAt,
  openHaproxyDocument,
  openTempFixtureDocument,
  referenceLocationsAt,
  replaceDocumentContent,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForSchemaDiagnostics,
} from "./helpers";

const NAVIGATION_CONFIG = [
  "defaults profile_default",
  "    mode http",
  "frontend web from profile_default",
  "    bind :80",
  "    acl is_api path_beg /api",
  "    use_backend api if is_api",
  "backend api",
  "    server web1 127.0.0.1:8080 check",
  "    use-server web1 if is_api",
].join("\n");

suite("Language feature integration", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  suite("Navigation providers", () => {
    test("go to definition resolves backend, server, and defaults profile targets", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);

      const backendDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(5, "    use_backend ".length),
      );
      assert.strictEqual(backendDefs.length, 1, "Expected one backend definition");
      assert.strictEqual(backendDefs[0]?.range.start.line, 6);

      const serverDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(8, "    use-server ".length),
      );
      assert.strictEqual(serverDefs.length, 1, "Expected one server definition");
      assert.strictEqual(serverDefs[0]?.range.start.line, 7);

      const defaultsDefs = await definitionLocationsAt(
        doc.uri,
        new vscode.Position(2, "frontend web from ".length),
      );
      assert.strictEqual(defaultsDefs.length, 1, "Expected one defaults profile definition");
      assert.strictEqual(defaultsDefs[0]?.range.start.line, 0);
    });

    test("find references returns ACL definition and frontend condition usage", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const pos = new vscode.Position(5, "    use_backend api if ".length);

      const references = await referenceLocationsAt(doc.uri, pos, true);
      assert.strictEqual(references.length, 2, "Expected ACL definition plus one condition usage");
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [4, 5],
      );
    });

    test("find references resolves backend, server, and defaults profile sites", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);

      let references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(5, "    use_backend ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [5, 6],
      );

      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(8, "    use-server ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [7, 8],
      );

      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(2, "frontend web from ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 2],
      );
    });

    test("find references resolves cache, resolvers, userlist, and peers symbols", async () => {
      let doc = await openHaproxyDocument(
        "cache bench_cache\n    total-max-size 4\nfrontend web\n    http-request cache-use bench_cache\n",
      );
      let references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "cache ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );

      doc = await openHaproxyDocument(
        "resolvers mydns\n    nameserver ns1 127.0.0.1:53\nbackend api\n    server s1 host:80 resolvers mydns\n",
      );
      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "resolvers ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );

      doc = await openHaproxyDocument(
        "userlist stats-auth\n    user admin insecure-password admin\nfrontend web\n    acl AUTH http_auth(stats-auth)\n",
      );
      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "userlist ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );

      doc = await openHaproxyDocument(
        "peers mypeers\n    peer p1 127.0.0.1:10000\nfrontend web\n    stick-table type ip size 1 peers mypeers\n",
      );
      references = await referenceLocationsAt(
        doc.uri,
        new vscode.Position(0, "peers ".length),
        true,
      );
      assert.deepStrictEqual(
        references.map((location) => location.range.start.line).sort((a, b) => a - b),
        [0, 3],
      );
    });
  });

  suite("Outline and folding", () => {
    test("document symbols expose top-level section outline", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const symbols = await vscode.commands.executeCommand<
        Array<vscode.DocumentSymbol | vscode.SymbolInformation>
      >("vscode.executeDocumentSymbolProvider", doc.uri);

      assert.ok(symbols && symbols.length >= 3, "Expected section symbols");
      const names = symbols.map((symbol) => symbol.name);
      assert.deepStrictEqual(names.slice(0, 3), [
        "defaults profile_default",
        "frontend web from profile_default",
        "backend api",
      ]);
    });

    test("folding ranges cover section bodies", async () => {
      const doc = await openHaproxyDocument(NAVIGATION_CONFIG);
      const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
        "vscode.executeFoldingRangeProvider",
        doc.uri,
      );

      assert.ok(ranges && ranges.length >= 3, "Expected folding ranges");
      assert.ok(
        ranges.some((range) => range.start === 0 && range.end === 1),
        "Expected defaults folding range",
      );
      assert.ok(
        ranges.some((range) => range.start === 2 && range.end === 5),
        "Expected frontend folding range",
      );
      assert.ok(
        ranges.some((range) => range.start === 6 && range.end === 8),
        "Expected backend folding range",
      );
    });
  });

  suite("Diagnostics lifecycle", () => {
    suiteTeardown(async () => {
      await updateHaproxySetting("diagnostics.enabled", true);
      await clearHaproxySetting("diagnostics.unusedSymbols.sections");
      await updateHaproxySetting("diagnostics.unusedSymbols", false);
    });

    test("diagnostics refresh after document edits", async () => {
      let doc = await openHaproxyDocument("frontend web\n    mode ftp\n");
      let diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "invalid mode before edit");

      doc = await replaceDocumentContent(doc, "frontend web\n    mode http\n");
      diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(
        errors.length,
        0,
        `Expected diagnostics to clear after edit, got: ${errors.map((d) => d.message).join(", ")}`,
      );
    });

    test("save recomputes diagnostics for file-backed documents", async () => {
      let doc = await openTempFixtureDocument("save-refresh.cfg", "frontend web\n    mode ftp\n");
      let diagnostics = await waitForSchemaDiagnostics(doc.uri);
      assertDiagnosticCounts(diagnostics, { "unknown-value": 1 }, "invalid mode before save");

      doc = await replaceDocumentContent(doc, "frontend web\n    mode http\n");
      const saved = await doc.save();
      assert.strictEqual(saved, true, "Expected temp config save to succeed");
      diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
      assert.strictEqual(errors.length, 0, "Expected no errors after save refresh");
    });

    test("unused symbol diagnostics stay off by default", async () => {
      const doc = await openHaproxyDocument(
        "frontend web\n    bind :80\n    acl blocked path_beg /admin\nbackend old_api\n    server s1 127.0.0.1:80\n",
      );
      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
      assert.strictEqual(
        diagnostics.filter((diag) => formatDiagnosticCode(diag.code).startsWith("unused-")).length,
        0,
        "Unused diagnostics should be disabled by default",
      );
    });

    test("enabling unused symbol diagnostics surfaces ACL and section hints", async () => {
      const doc = await openHaproxyDocument(
        "frontend web\n    bind :80\n    acl blocked path_beg /admin\nbackend old_api\n    server s1 127.0.0.1:80\n",
      );

      await updateHaproxySetting("diagnostics.unusedSymbols", true);
      const diagnostics = await waitForSchemaDiagnostics(doc.uri, 2);
      assertDiagnosticCounts(
        diagnostics,
        { "unused-acl": 1, "unused-section": 1 },
        "unused diagnostics enabled",
      );
    });
  });

  suite("Completion and hover coverage", () => {
    suiteTeardown(async () => {
      await ensureHaproxyVersion("3.2");
    });

    test("mode completion and hover update across supported versions", async () => {
      const doc = await openHaproxyDocument("defaults\n    mode h\n");
      const completionPos = new vscode.Position(1, "    mode h".length);

      await ensureHaproxyVersion("3.2");
      let labels = await completionLabelsAt(doc.uri, completionPos);
      assert.ok(labels.includes("http"), "Expected http completion on 3.2");
      assert.ok(!labels.includes("haterm"), "Did not expect haterm on 3.2");

      let hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
      assert.ok(!hoverText.includes("haterm"), "Did not expect haterm hover text on 3.2");

      await ensureHaproxyVersion("3.4");
      labels = await completionLabelsAt(doc.uri, completionPos);
      assert.ok(labels.includes("haterm"), "Expected haterm completion on 3.4");

      hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
      assert.ok(hoverText.includes("haterm"), "Expected haterm hover text on 3.4");
    });

    test("completion covers options and ACL criteria", async () => {
      let doc = await openHaproxyDocument("defaults\n    no option \n");
      let labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    no option ".length),
      );
      assert.ok(labels.includes("httplog"), "Expected option completion for httplog");
      assert.ok(labels.includes("forwardfor"), "Expected option completion for forwardfor");

      doc = await openHaproxyDocument("frontend web\n    acl test \n");
      labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "    acl test ".length));
      assert.ok(labels.includes("path"), "Expected ACL criterion completion for path");
    });

    test("completion covers bind options, server option values, and sample converters", async () => {
      let doc = await openHaproxyDocument("frontend web\n    bind 127.0.0.1:80 \n");
      let labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    bind 127.0.0.1:80 ".length),
      );
      assert.ok(labels.includes("ssl"), "Expected bind option completion for ssl");
      assert.ok(labels.includes("interface"), "Expected bind option completion for interface");

      doc = await openHaproxyDocument("backend api\n    server s1 127.0.0.1:80 cookie app01 ins\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    server s1 127.0.0.1:80 cookie app01 ins".length),
      );
      assert.ok(labels.includes("insert"), "Expected server option value completion");

      doc = await openHaproxyDocument("frontend web\n    http-request set-header X %[path(0):\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-request set-header X %[path(0):".length),
      );
      assert.ok(labels.length > 0, "Expected sample converter completions");
    });

    test("completion covers additional rule and action families", async () => {
      let doc = await openHaproxyDocument("frontend web\n    tcp-request connection \n");
      let labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    tcp-request connection ".length),
      );
      assert.ok(labels.length > 0, "Expected tcp-request action completions");
      assert.ok(!labels.includes("acl"), "Unexpected ACL completion in tcp-request actions");

      doc = await openHaproxyDocument("frontend web\n    http-response set\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-response ".length),
      );
      assert.ok(labels.includes("set-header"), "Expected http-response action completion");

      doc = await openHaproxyDocument("frontend web\n    http-after-response set\n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-after-response ".length),
      );
      assert.ok(labels.includes("set-header"), "Expected http-after-response action completion");

      doc = await openHaproxyDocument("frontend web\n    tcp-response content \n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    tcp-response content ".length),
      );
      assert.ok(labels.length > 0, "Expected tcp-response action completions");
      assert.ok(!labels.includes("acl"), "Unexpected ACL completion in tcp-response actions");

      doc = await openHaproxyDocument("frontend web\n    http-request use-service \n");
      labels = await completionLabelsAt(
        doc.uri,
        new vscode.Position(1, "    http-request use-service ".length),
      );
      assert.ok(labels.length > 0, "Expected use-service completions");
    });

    test("hover covers option, action, and sample fetch docs", async () => {
      let doc = await openHaproxyDocument("defaults\n    option httplog\n");
      let text = await hoverTextAt(doc.uri, new vscode.Position(1, "    option h".length));
      assert.ok(text.includes("Valid in sections:"), "Expected option hover metadata");

      doc = await openHaproxyDocument("frontend web\n    http-request deny\n");
      text = await hoverTextAt(doc.uri, new vscode.Position(1, "    http-request d".length));
      assert.ok(text.toLowerCase().includes("deny"), "Expected action hover for deny");
      assert.ok(text.toLowerCase().includes("reject"), "Expected deny description");

      doc = await openHaproxyDocument(
        "frontend web\n    http-request set-header X-Test %[req.hdr(host)]\n",
      );
      text = await hoverTextAt(doc.uri, new vscode.Position(1, 39));
      assert.ok(text.toLowerCase().includes("req.hdr"), "Expected sample fetch hover");
      assert.ok(text.toLowerCase().includes("returns"), "Expected sample fetch description");
    });

    test("hover covers additional rule and action families", async () => {
      let doc = await openHaproxyDocument("frontend web\n    http-request track-sc1 src\n");
      let text = await hoverTextAt(doc.uri, new vscode.Position(1, "    http-request ".length + 2));
      assert.ok(text.includes("track-sc1"), "Expected track-sc1 hover");
      assert.ok(text.toLowerCase().includes("sticky"), "Expected sticky-counter description");

      doc = await openHaproxyDocument("frontend web\n    http-request set-path /api\n");
      text = await hoverTextAt(doc.uri, new vscode.Position(1, "    http-request ".length + 2));
      assert.ok(text.includes("set-path"), "Expected set-path hover");
      assert.ok(text.toLowerCase().includes("rewrites"), "Expected set-path description");

      doc = await openHaproxyDocument('defaults\n    log-format "%{+Q}o %ci"\n');
      text = await hoverTextAt(doc.uri, new vscode.Position(1, '    log-format "%{+Q}o %'.length));
      assert.ok(text.includes("%ci"), "Expected log-format alias hover");
    });
  });

  suite("Formatting", () => {
    suiteTeardown(async () => {
      await updateHaproxySetting("format.enabled", true);
      await updateHaproxySetting("format.indent", "spaces-4");
      await updateHaproxySetting("format.insertBlankLineBetweenSections", true);
    });

    test("tab indentation is honored by format document", async () => {
      await updateHaproxySetting("format.enabled", true);
      await updateHaproxySetting("format.indent", "tab");
      const formatted = await formatDocumentContent(
        "frontend web\n      bind :443 # keep comment\n",
      );
      assert.strictEqual(formatted, "frontend web\n\tbind :443 # keep comment\n");
    });
  });

  suite("Supported version bundle smoke tests", () => {
    test("completion, hover, and diagnostics work across every bundled version", async function () {
      this.timeout(90000);

      for (const version of ["2.6", "2.8", "3.0", "3.2", "3.4"]) {
        await ensureHaproxyVersion(version);
        const doc = await openHaproxyDocument("defaults\n    mode http\n");

        const diagnostics = await waitForSchemaDiagnostics(doc.uri, 0);
        const errors = filterDiagnostics(diagnostics, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(errors.length, 0, `Expected no errors on ${version}`);

        const labels = await completionLabelsAt(
          doc.uri,
          new vscode.Position(1, "    mode ".length),
        );
        assert.ok(labels.includes("http"), `Expected http completion on ${version}`);

        const hoverText = await hoverTextAt(doc.uri, new vscode.Position(1, 7));
        assert.ok(hoverText.length > 0, `Expected non-empty hover on ${version}`);
      }
    });
  });
});
