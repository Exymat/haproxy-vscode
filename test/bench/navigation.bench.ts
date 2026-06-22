import { bench, describe } from "vitest";

import { provideDocumentSymbols } from "../../src/documentSymbols";
import { provideDefinition, provideReferences } from "../../src/navigation";
import { loadSchemaBundle } from "../helpers/schema";
import { createDocument } from "../helpers/document";
import { findLineContaining, readFixture } from "./helpers";

const bundle = loadSchemaBundle("3.2");
const largeContent = readFixture("large-valid.cfg", "bench");
const largeDoc = createDocument(largeContent);
const maxDiagnosticsLines = 4000;
const largeDefaultBackendLine = findLineContaining(largeContent, "default_backend bench_api_0000");

const navigationContent = [
  "backend api",
  "    server s1 127.0.0.1:8080",
  "frontend web",
  "    use_backend api",
].join("\n");

describe("navigation", () => {
  bench("definition: use_backend reference", () => {
    const doc = createDocument(navigationContent);
    const line = 3;
    const character = "    use_backend api".indexOf("api");
    provideDefinition(doc, { line, character } as never, bundle.schema, maxDiagnosticsLines);
  });

  bench("references: use_backend declaration", () => {
    const doc = createDocument(navigationContent);
    const line = 3;
    const character = "    use_backend api".indexOf("api");
    provideReferences(
      doc,
      { line, character } as never,
      { includeDeclaration: true },
      bundle.schema,
      maxDiagnosticsLines,
    );
  });

  bench("document symbols: sample.cfg", () => {
    const doc = createDocument(readFixture("sample.cfg", "integration"));
    provideDocumentSymbols(doc);
  });

  bench("document symbols: large-valid.cfg", () => {
    provideDocumentSymbols(largeDoc);
  });

  bench(
    "definition warm: large-valid.cfg default_backend",
    () => {
      const target = "bench_api_0000";
      const character = largeContent.split(/\r?\n/)[largeDefaultBackendLine].indexOf(target);
      for (let i = 0; i < 50; i += 1) {
        provideDefinition(
          largeDoc,
          { line: largeDefaultBackendLine, character } as never,
          bundle.schema,
          maxDiagnosticsLines,
        );
      }
    },
    { time: 500, warmupIterations: 3 },
  );
});
