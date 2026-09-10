import { describe, test } from "vitest";

import { getParsedDocument as getParsedDocumentImpl } from "../../src/parser/parseCache";
import { parseDocument as parseDocumentImpl } from "../helpers/parse";
import {
  buildSymbolIndex as buildSymbolIndexImpl,
  findSiteAtPosition as findSiteAtPositionImpl,
  getSymbolIndex as getSymbolIndexImpl,
} from "../../src/symbolIndex";
import { loadSchemaBundle } from "../helpers/schema";
import {
  createDocument as createDocumentImpl,
  updateDocument as updateDocumentImpl,
} from "../helpers/document";
import {
  BENCH_LARGE_MAX_LINES as BENCH_LARGE_MAX_LINES_IMPL,
  findLineContaining,
  readFixture,
} from "./helpers";

const getParsedDocument = getParsedDocumentImpl;
const parseDocument = parseDocumentImpl;
const buildSymbolIndex = buildSymbolIndexImpl;
const findSiteAtPosition = findSiteAtPositionImpl;
const getSymbolIndex = getSymbolIndexImpl;
const createDocument = createDocumentImpl;
const updateDocument = updateDocumentImpl;
const BENCH_LARGE_MAX_LINES = BENCH_LARGE_MAX_LINES_IMPL;

const bundle = loadSchemaBundle("3.2");
const largeContent = readFixture("large-valid.cfg", "bench");
const largeDoc = createDocument(largeContent);
const largeDefaultBackendLine = findLineContaining(largeContent, "default_backend bench_api_0000");
const largeDefaultBackendCharacter = largeContent
  .split(/\r?\n/)
  [largeDefaultBackendLine].indexOf("bench_api_0000");
const benignEditLine = findLineContaining(largeContent, "maxconn 200000");

describe("symbolIndex", () => {
  test("buildSymbolIndex cold: large-valid.cfg", async ({ bench }) => {
    await bench("buildSymbolIndex cold: large-valid.cfg", () => {
      const parsed = parseDocument(createDocument(largeContent));
      buildSymbolIndex(parsed, bundle.schema);
    }).run();
  });

  test("getSymbolIndex warm lookup: large-valid.cfg", async ({ bench }) => {
    await bench("getSymbolIndex warm lookup: large-valid.cfg", () => {
      getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
    }).run({ warmupIterations: 2 });
  });

  test("findSiteAtPosition warm: large-valid.cfg", async ({ bench }) => {
    await bench("findSiteAtPosition warm: large-valid.cfg", () => {
      const index = getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
      if (index) {
        findSiteAtPosition(index, {
          line: largeDefaultBackendLine,
          character: largeDefaultBackendCharacter,
        } as never);
      }
    }).run({ warmupIterations: 2 });
  });

  test("incremental reuse: single-line edit", async ({ bench }) => {
    await bench("incremental reuse: single-line edit", () => {
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
    }).run();
  });
});
