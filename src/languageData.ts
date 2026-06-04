import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { DEFAULT_HAPROXY_VERSION, HaproxyVersion } from "./version";

export interface LanguageGroupItem {
  name: string;
  description: string;
  signature: string;
  rulesets: string[];
  docsUrl?: string;
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

export interface LanguageKeyword {
  name: string;
  sections: string[];
  signatures: string[];
  description: string;
  docsUrl: string;
  arguments?: LanguageArgumentParam[];
}

export interface HaproxyLanguageData {
  version: string;
  docsBaseUrl: string;
  keywords: Record<string, LanguageKeyword>;
  groups: Record<string, LanguageGroupItem[]>;
}

const languageDataCache = new Map<HaproxyVersion, HaproxyLanguageData>();

export function clearLanguageDataCache(): void {
  languageDataCache.clear();
}

export function loadLanguageData(
  context: vscode.ExtensionContext,
  version: HaproxyVersion = DEFAULT_HAPROXY_VERSION
): HaproxyLanguageData {
  const cached = languageDataCache.get(version);
  if (cached) {
    return cached;
  }
  const filePath = path.join(context.extensionPath, "schemas", `haproxy-${version}.language.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as HaproxyLanguageData;
  languageDataCache.set(version, data);
  return data;
}

export function findKeywordByPrefix(
  data: HaproxyLanguageData,
  prefix: string
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
