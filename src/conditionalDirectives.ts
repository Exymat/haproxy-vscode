import { HaproxyLanguageData } from "./languageData";
import { HaproxySchema } from "./schema/types";
import { macroTokenSet } from "./schema/tokens";
import type { HaproxyVersion } from "./version";

export interface ConditionalDirectiveInfo {
  name: string;
  signature: string;
  description: string;
  docsChapter?: string;
}

export function lookupConditionalDirective(
  data: HaproxyLanguageData,
  token: string,
): ConditionalDirectiveInfo | undefined {
  const directives = data.conditionalDirectives ?? [];
  return directives.find((entry) => entry.name.toLowerCase() === token.toLowerCase());
}

export function conditionalBlocksDocsUrl(
  data: HaproxyLanguageData,
  version: HaproxyVersion,
): string {
  const chapter = data.conditionalDirectives?.[0]?.docsChapter ?? "2.4";
  return `https://docs.haproxy.org/${version}/configuration.html#${chapter}`;
}

export function isConditionalOrStatusDirective(
  schema: HaproxySchema,
  token: string | undefined,
): boolean {
  if (!token) {
    return false;
  }
  return macroTokenSet(schema).has(token.toLowerCase());
}
