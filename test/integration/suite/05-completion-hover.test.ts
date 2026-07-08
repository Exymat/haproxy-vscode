import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  completionLabelsAt,
  completionItemsAt,
  ensureHaproxyVersion,
  hoverTextAt,
  openFixture,
  openHaproxyDocument,
  positionOf,
  resetHaproxySettings,
} from "./helpers";

suite("Completion and hover coverage", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
  });

  suiteTeardown(async () => {
    await ensureHaproxyVersion("3.2");
    await resetHaproxySettings();
  });

  test("file-backed basic-check fixture provides stats hover and tcp-check completion", async () => {
    const doc = await openFixture("valid-basic-check.cfg");
    const statsHover = await hoverTextAt(doc.uri, positionOf(doc, "stats socket"));
    assert.ok(statsHover.length > 0, "Expected stats socket hover");
    assert.ok(statsHover.toLowerCase().includes("stats"), "Expected stats hover text");

    const optionLine = positionOf(doc, "\t\n\tserver");
    const labels = await completionLabelsAt(
      doc.uri,
      new vscode.Position(optionLine.line, "\t".length),
    );
    assert.ok(
      labels.some((label) => label.startsWith("tcp-check")),
      `Expected tcp-check directive completion, got: ${labels.join(", ")}`,
    );
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
    let labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "    no option ".length));
    assert.ok(labels.includes("httplog"), "Expected option completion for httplog");
    assert.ok(labels.includes("forwardfor"), "Expected option completion for forwardfor");

    doc = await openHaproxyDocument("frontend web\n    acl test \n");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "    acl test ".length));
    assert.ok(labels.includes("path"), "Expected ACL criterion completion for path");
  });

  test("completion suggests defined symbol references", async () => {
    let doc = await openHaproxyDocument("backend api\nfrontend web\n    use_backend ");
    let labels = await completionLabelsAt(
      doc.uri,
      new vscode.Position(2, "    use_backend ".length),
    );
    assert.ok(labels.includes("api"), "Expected backend completion for use_backend");

    doc = await openHaproxyDocument("defaults base\nfrontend web from ");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "frontend web from ".length));
    assert.ok(labels.includes("base"), "Expected defaults profile completion after from");

    doc = await openHaproxyDocument(
      "frontend web\n    acl is_api path_beg /api\n    use_backend api if ",
    );
    labels = await completionLabelsAt(
      doc.uri,
      new vscode.Position(2, "    use_backend api if ".length),
    );
    assert.ok(labels.includes("is_api"), "Expected scoped ACL completion in rule condition");
    assert.ok(labels.includes("TRUE"), "Expected predefined ACL completion in rule condition");
  });

  test("completion covers section headers at top level", async () => {
    let doc = await openHaproxyDocument("");
    let labels = await completionLabelsAt(doc.uri, new vscode.Position(0, 0));
    assert.ok(labels.includes("global"), "Expected global section header on empty file");
    assert.ok(labels.includes("defaults"), "Expected defaults section header on empty file");
    assert.ok(labels.includes("frontend"), "Expected frontend section header on empty file");
    assert.ok(labels.includes("backend"), "Expected backend section header on empty file");

    doc = await openHaproxyDocument("fron");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(0, "fron".length));
    assert.ok(labels.includes("frontend"), "Expected frontend completion for partial fron");
    assert.ok(!labels.includes("backend"), "Did not expect backend for partial fron");

    doc = await openHaproxyDocument("back");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(0, "back".length));
    assert.ok(labels.includes("backend"), "Expected backend completion for partial back");

    doc = await openHaproxyDocument("global");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(0, 1));
    assert.ok(labels.includes("global"), "Expected global when editing a section keyword");

    doc = await openHaproxyDocument("global\n    daemon\n");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(2, 0));
    assert.ok(labels.includes("frontend"), "Expected frontend on blank line between sections");
    assert.ok(labels.includes("defaults"), "Expected defaults on blank line between sections");

    doc = await openHaproxyDocument("defaults\n    mode http\n    \n    balance roundrobin\n");
    labels = await completionLabelsAt(doc.uri, new vscode.Position(2, 4));
    assert.ok(
      labels.includes("balance"),
      "Expected in-section directive on indented blank line inside a section",
    );
    assert.ok(
      !labels.includes("frontend"),
      "Did not expect section header on indented blank line inside a section",
    );

    doc = await openHaproxyDocument("frontend web");
    const sectionNameItems = await completionItemsAt(
      doc.uri,
      new vscode.Position(0, "frontend web".indexOf("web")),
    );
    const sectionHeadersOnName = sectionNameItems.filter(
      (item) => item.detail === "HAProxy section",
    );
    assert.strictEqual(
      sectionHeadersOnName.length,
      0,
      "Did not expect section header completion on section name token",
    );

    doc = await openHaproxyDocument("glob");
    const items = await completionItemsAt(doc.uri, new vscode.Position(0, "glob".length));
    const globalItem = items.find(
      (item) => (typeof item.label === "string" ? item.label : item.label.label) === "global",
    );
    assert.ok(globalItem, "Expected global completion item for partial glob");
    assert.strictEqual(globalItem.detail, "HAProxy section");
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
    labels = await completionLabelsAt(doc.uri, new vscode.Position(1, "    http-response ".length));
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
