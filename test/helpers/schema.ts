import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { HaproxyLanguageData } from "../../src/languageData";
import type { HaproxySchema } from "../../src/schema/types";

export const SUPPORTED_VERSIONS = ["2.6", "2.8", "3.0", "3.2", "3.4"] as const;
export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

const extensionRoot = join(__dirname, "..", "..");

export function loadSchema(version: SupportedVersion): HaproxySchema {
  const path = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
  if (!existsSync(path)) {
    throw new Error(`missing schema: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as HaproxySchema;
}

export function loadLanguageData(version: SupportedVersion): HaproxyLanguageData {
  const path = join(extensionRoot, "schemas", `haproxy-${version}.language.json`);
  if (!existsSync(path)) {
    throw new Error(`missing language data: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as HaproxyLanguageData;
}

export function loadSchemaBundle(version: SupportedVersion): {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
} {
  return {
    schema: loadSchema(version),
    languageData: loadLanguageData(version),
  };
}

export function loadAllSchemas(): Record<SupportedVersion, HaproxySchema> {
  return Object.fromEntries(
    SUPPORTED_VERSIONS.map((version) => [version, loadSchema(version)]),
  ) as Record<SupportedVersion, HaproxySchema>;
}

export function loadAllLanguageData(): Record<SupportedVersion, HaproxyLanguageData> {
  return Object.fromEntries(
    SUPPORTED_VERSIONS.map((version) => [version, loadLanguageData(version)]),
  ) as Record<SupportedVersion, HaproxyLanguageData>;
}
