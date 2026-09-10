import { join } from "node:path";
import { beforeEach, describe, test } from "vitest";

import { loadLanguageData, loadSchema, loadSchemaBundle } from "../helpers/schema";
import { clearBenchSchemaCache, extensionRoot, loadSchemaFileWarm } from "./helpers";

const version = "3.2" as const;
const schemaPath = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
const languagePath = join(extensionRoot, "schemas", `haproxy-${version}.language.json`);

describe("startup", () => {
  beforeEach(() => {
    clearBenchSchemaCache();
  });

  test("loadSchema cold", async ({ bench }) => {
    await bench("loadSchema cold", () => {
      loadSchema(version);
    }).run();
  });

  test("loadLanguageData cold", async ({ bench }) => {
    await bench("loadLanguageData cold", () => {
      loadLanguageData(version);
    }).run();
  });

  test("loadSchemaBundle cold", async ({ bench }) => {
    await bench("loadSchemaBundle cold", () => {
      loadSchemaBundle(version);
    }).run();
  });

  test("loadSchema warm (cached parse)", async ({ bench }) => {
    await bench("loadSchema warm (cached parse)", () => {
      loadSchemaFileWarm(`schema-${version}`, schemaPath);
    }).run({ warmupIterations: 5 });
  });

  test("loadLanguageData warm (cached parse)", async ({ bench }) => {
    await bench("loadLanguageData warm (cached parse)", () => {
      loadSchemaFileWarm(`language-${version}`, languagePath);
    }).run({ warmupIterations: 5 });
  });

  test("loadSchemaBundle warm (cached parse)", async ({ bench }) => {
    await bench("loadSchemaBundle warm (cached parse)", () => {
      loadSchemaFileWarm(`schema-${version}`, schemaPath);
      loadSchemaFileWarm(`language-${version}`, languagePath);
    }).run({ warmupIterations: 5 });
  });
});
