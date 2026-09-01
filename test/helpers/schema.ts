import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { HaproxyLanguageData } from "../../src/language/languageData";
import type { HaproxySchema } from "../../src/schema/types";

export const SUPPORTED_VERSIONS = ["2.6", "2.8", "3.0", "3.2", "3.4"] as const;
export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];
export const HAPEE_SCHEMA_VERSIONS = ["2.6", "2.8", "3.0", "3.2"] as const;
export type HapeeSchemaVersion = (typeof HAPEE_SCHEMA_VERSIONS)[number];

const extensionRoot = join(__dirname, "..", "..");

export function hapeeArtifactId(version: HapeeSchemaVersion): string {
  return `${version}r1`;
}

export function loadSchema(version: string): HaproxySchema {
  const path = join(extensionRoot, "schemas", `haproxy-${version}.schema.json`);
  if (!existsSync(path)) {
    throw new Error(`missing schema: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as HaproxySchema;
}

export function loadLanguageData(version: string): HaproxyLanguageData {
  const path = join(extensionRoot, "schemas", `haproxy-${version}.language.json`);
  if (!existsSync(path)) {
    throw new Error(`missing language data: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as HaproxyLanguageData;
}

export function loadSchemaBundle(version: string): {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
} {
  return {
    schema: loadSchema(version),
    languageData: loadLanguageData(version),
  };
}

export function loadHapeeBundle(version: HapeeSchemaVersion): {
  schema: HaproxySchema;
  languageData: HaproxyLanguageData;
} {
  return loadSchemaBundle(hapeeArtifactId(version));
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
