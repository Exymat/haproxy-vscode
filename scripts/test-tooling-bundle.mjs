#!/usr/bin/env node
import {
  createDocument,
  loadCompiledModule,
  loadLanguageData,
  loadSchema,
} from "./lib/extension-runtime.mjs";

const { computeDiagnostics } = loadCompiledModule("diagnostics.js");
if (typeof computeDiagnostics !== "function") {
  throw new Error("diagnostics tooling bundle does not export computeDiagnostics");
}

const diagnostics = computeDiagnostics(createDocument("global\n    daemon"), loadSchema("3.2"), {
  languageData: loadLanguageData("3.2"),
  deprecatedWarnings: true,
});
if (!Array.isArray(diagnostics)) {
  throw new Error("diagnostics tooling bundle returned a non-array result");
}

console.log(`Diagnostics tooling bundle passed (${diagnostics.length} diagnostics)`);
