import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { DEFAULT_HAPROXY_VERSION, HaproxyVersion } from "../extension/version";
import { normalizeSchemaData } from "./contract";
import type { HaproxySchema } from "./types";

const schemaCache = new Map<HaproxyVersion, HaproxySchema>();

export function clearSchemaCache(): void {
  schemaCache.clear();
}

export function loadSchema(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION,
): HaproxySchema {
  const cached = schemaCache.get(version);
  if (cached) {
    return cached;
  }
  const schemaPath = path.join(context.extensionPath, "schemas", `haproxy-${version}.schema.json`);
  try {
    const raw = fs.readFileSync(schemaPath, "utf-8");
    const data = normalizeSchemaData(JSON.parse(raw) as HaproxySchema);
    schemaCache.set(version, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load HAProxy schema for ${version} from ${schemaPath}: ${message}`, {
      cause: error,
    });
  }
}

export async function loadSchemaAsync(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION,
): Promise<HaproxySchema> {
  const cached = schemaCache.get(version);
  if (cached) {
    return cached;
  }
  const schemaPath = path.join(context.extensionPath, "schemas", `haproxy-${version}.schema.json`);
  try {
    const raw = await fs.promises.readFile(schemaPath, "utf-8");
    const data = normalizeSchemaData(JSON.parse(raw) as HaproxySchema);
    schemaCache.set(version, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load HAProxy schema for ${version} from ${schemaPath}: ${message}`, {
      cause: error,
    });
  }
}
