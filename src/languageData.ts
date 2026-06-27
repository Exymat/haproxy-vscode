import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { clearLanguageDataIndexCache } from "./languageDataIndexes";
import { DEFAULT_HAPROXY_VERSION, HaproxyVersion } from "./version";

export interface LanguageExample {
  title: string;
  code: string;
}

export interface LanguageGroupItem {
  name: string;
  description: string;
  signature: string;
  rulesets: string[];
  docsUrl?: string;
  examples?: LanguageExample[];
}

export interface LanguageArgumentValue {
  name: string;
  description: string;
}

export interface LanguageArgumentParam {
  parameter: string;
  description: string;
  values: LanguageArgumentValue[];
}

export interface LanguageKeywordVariant {
  chapter: string;
  sections: string[];
  signatures: string[];
  description: string;
  docsUrl: string;
  arguments?: LanguageArgumentParam[];
  contexts?: string[];
  examples?: LanguageExample[];
}

export interface LanguageKeyword {
  name: string;
  sections: string[];
  signatures: string[];
  description: string;
  docsUrl: string;
  arguments?: LanguageArgumentParam[];
  variants?: LanguageKeywordVariant[];
  examples?: LanguageExample[];
}

export interface HaproxyLanguageData {
  version: string;
  docsBaseUrl: string;
  keywords: Record<string, LanguageKeyword>;
  groups: Record<string, LanguageGroupItem[]>;
}

const languageDataCache = new Map<HaproxyVersion, HaproxyLanguageData>();

function assertLanguageDataContract(data: HaproxyLanguageData): void {
  if (!data.version || typeof data.version !== "string") {
    throw new Error("HAProxy language data is missing a version string");
  }
  if (!data.keywords || typeof data.keywords !== "object") {
    throw new Error("HAProxy language data is missing keywords");
  }
  if (!data.groups || typeof data.groups !== "object") {
    throw new Error("HAProxy language data is missing groups");
  }
}

function normalizeLanguageData(data: HaproxyLanguageData): HaproxyLanguageData {
  assertLanguageDataContract(data);
  return data;
}

export function clearLanguageDataCache(): void {
  languageDataCache.clear();
  clearLanguageDataIndexCache();
}

export function loadLanguageData(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION,
): HaproxyLanguageData {
  const cached = languageDataCache.get(version);
  if (cached) {
    return cached;
  }
  const filePath = path.join(context.extensionPath, "schemas", `haproxy-${version}.language.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = normalizeLanguageData(JSON.parse(raw) as HaproxyLanguageData);
    languageDataCache.set(version, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load HAProxy language data for ${version} from ${filePath}: ${message}`,
      { cause: error },
    );
  }
}

export async function loadLanguageDataAsync(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION,
): Promise<HaproxyLanguageData> {
  const cached = languageDataCache.get(version);
  if (cached) {
    return cached;
  }
  const filePath = path.join(context.extensionPath, "schemas", `haproxy-${version}.language.json`);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = normalizeLanguageData(JSON.parse(raw) as HaproxyLanguageData);
    languageDataCache.set(version, data);
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load HAProxy language data for ${version} from ${filePath}: ${message}`,
      { cause: error },
    );
  }
}

export function findKeywordByPrefix(
  data: HaproxyLanguageData,
  prefix: string,
): LanguageKeyword | undefined {
  const lower = prefix.toLowerCase();
  if (data.keywords[lower]) {
    return data.keywords[lower];
  }
  let best: LanguageKeyword | undefined;
  for (const kw of Object.values(data.keywords)) {
    const name = kw.name.toLowerCase();
    if (lower.startsWith(name) && (!best || name.length > best.name.length)) {
      best = kw;
    }
  }
  return best;
}
