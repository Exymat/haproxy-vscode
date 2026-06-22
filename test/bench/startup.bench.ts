import { join } from "node:path";
import { bench, beforeEach, describe } from "vitest";

import { loadLanguageData, loadSchema, loadSchemaBundle } from "../helpers/schema";
import { clearBenchSchemaCache, extensionRoot, loadSchemaFileWarm } from "./helpers";

const version = "3.2" as const;
const schemaPath = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
const languagePath = join(extensionRoot, "schemas", `haproxy-${version}.language.json`);

describe("startup", () => {
  beforeEach(() => {
    clearBenchSchemaCache();
  });

  bench("loadSchema cold", () => {
    loadSchema(version);
  });

  bench("loadLanguageData cold", () => {
    loadLanguageData(version);
  });

  bench("loadSchemaBundle cold", () => {
    loadSchemaBundle(version);
  });

  bench(
    "loadSchema warm (cached parse)",
    () => {
      loadSchemaFileWarm(`schema-${version}`, schemaPath);
    },
    { warmupIterations: 5 },
  );

  bench(
    "loadLanguageData warm (cached parse)",
    () => {
      loadSchemaFileWarm(`language-${version}`, languagePath);
    },
    { warmupIterations: 5 },
  );

  bench(
    "loadSchemaBundle warm (cached parse)",
    () => {
      loadSchemaFileWarm(`schema-${version}`, schemaPath);
      loadSchemaFileWarm(`language-${version}`, languagePath);
    },
    { warmupIterations: 5 },
  );
});
