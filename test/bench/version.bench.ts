import { bench, beforeEach, describe } from "vitest";

import { loadSchemaBundle } from "../helpers/schema";
import { BENCH_VERSIONS, clearBenchSchemaCache } from "./helpers";

describe("version matrix", () => {
  beforeEach(() => {
    clearBenchSchemaCache();
  });

  for (const version of BENCH_VERSIONS) {
    bench(`loadSchemaBundle cold (${version})`, () => {
      loadSchemaBundle(version);
    });
  }
});
