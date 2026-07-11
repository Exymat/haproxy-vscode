import { bench, describe } from "vitest";

import { getParsedDocument } from "../../src/parser/parseCache";
import { parseDocument } from "../helpers/parse";
import { buildSymbolIndex, findSiteAtPosition, getSymbolIndex } from "../../src/symbolIndex";
import { loadSchemaBundle } from "../helpers/schema";
import { createDocument, updateDocument } from "../helpers/document";
import { BENCH_LARGE_MAX_LINES, findLineContaining, readFixture } from "./helpers";

const bundle = loadSchemaBundle("3.2");
const largeContent = readFixture("large-valid.cfg", "bench");
const largeDoc = createDocument(largeContent);
const largeDefaultBackendLine = findLineContaining(largeContent, "default_backend bench_api_0000");
const largeDefaultBackendCharacter = largeContent
  .split(/\r?\n/)
  [largeDefaultBackendLine].indexOf("bench_api_0000");
const benignEditLine = findLineContaining(largeContent, "maxconn 200000");

describe("symbolIndex", () => {
  bench("buildSymbolIndex cold: large-valid.cfg", () => {
    const parsed = parseDocument(createDocument(largeContent));
    buildSymbolIndex(parsed, bundle.schema);
  });

  bench(
    "getSymbolIndex warm lookup: large-valid.cfg",
    () => {
      getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
    },
    { warmupIterations: 2 },
  );

  bench(
    "findSiteAtPosition warm: large-valid.cfg",
    () => {
      const index = getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
      if (index) {
        findSiteAtPosition(index, {
          line: largeDefaultBackendLine,
          character: largeDefaultBackendCharacter,
        } as never);
      }
    },
    { warmupIterations: 2 },
  );

  bench("incremental reuse: single-line edit", () => {
    getParsedDocument(largeDoc);
    getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
    const lines = largeContent.split(/\r?\n/);
    const original = lines[benignEditLine];
    const toggled = original.endsWith(" ") ? original.trimEnd() : `${original} `;
    lines[benignEditLine] = toggled;
    updateDocument(largeDoc, lines.join("\n"));
    getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
    lines[benignEditLine] = original;
    updateDocument(largeDoc, lines.join("\n"));
  });
});
