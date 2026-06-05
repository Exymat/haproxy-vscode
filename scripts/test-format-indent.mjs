#!/usr/bin/env node
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const { formatIndentToOptions, legacyFormatIndent } = require(
  join(extensionRoot, "out", "formatIndent.js")
);
const { formatConfig } = require(join(extensionRoot, "out", "formatter.js"));

function assertEqual(name, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual("spaces-4", formatIndentToOptions("spaces-4"), { indentStyle: "spaces", indentSize: 4 });
assertEqual("spaces-2", formatIndentToOptions("spaces-2"), { indentStyle: "spaces", indentSize: 2 });
assertEqual("tab", formatIndentToOptions("tab"), { indentStyle: "tab", indentSize: 4 });
assertEqual("legacy tab", legacyFormatIndent("tab", 4), "tab");
assertEqual("legacy 2", legacyFormatIndent("spaces", 2), "spaces-2");
assertEqual("legacy 4", legacyFormatIndent("spaces", 4), "spaces-4");

const twoSpace = formatConfig("frontend web\n      bind :443", {
  ...formatIndentToOptions("spaces-2"),
  insertBlankLineBetweenSections: true,
});
if (twoSpace !== "frontend web\n  bind :443") {
  throw new Error(`spaces-2 format failed:\n${twoSpace}`);
}

console.log("format indent tests passed: 7");
