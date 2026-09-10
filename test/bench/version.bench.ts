import { beforeEach, describe, test } from "vitest";

import { loadSchemaBundle as loadSchemaBundleImpl } from "../helpers/schema";
import { BENCH_VERSIONS, clearBenchSchemaCache } from "./helpers";

const loadSchemaBundle = loadSchemaBundleImpl;

describe("version matrix", () => {
  beforeEach(() => {
    clearBenchSchemaCache();
  });

  for (const version of BENCH_VERSIONS) {
    test(`loadSchemaBundle cold (${version})`, async ({ bench }) => {
      await bench(`loadSchemaBundle cold (${version})`, () => {
        loadSchemaBundle(version);
      }).run();
    });
  }
});
