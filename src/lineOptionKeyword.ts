import { getKeywordFromSchema } from "./directiveUtils";
import { HaproxySchema } from "./schema";
import { ResolvedSchemaKeyword } from "./keywordVariant";

export const LINE_OPTION_CHAPTER_BIND = "5.1";
export const LINE_OPTION_CHAPTER_SERVER = "5.2";
export const GENERIC_KEYWORD_CHAPTER_PREFIX = "4.";

export function lineOptionChapter(kind: "bind" | "server"): string {
  return kind === "bind" ? LINE_OPTION_CHAPTER_BIND : LINE_OPTION_CHAPTER_SERVER;
}

export function resolveLineOptionSchemaKeyword(
  schema: HaproxySchema,
  option: string,
  kind: string | null | undefined,
  section: string | null | undefined,
): ResolvedSchemaKeyword | undefined {
  const keyword = schema.keywords[option];
  if (!keyword) {
    return undefined;
  }
  const resolved = getKeywordFromSchema(schema, option, section);
  if (
    resolved &&
    section &&
    resolved.sections.includes(section) &&
    resolved.chapter?.startsWith(GENERIC_KEYWORD_CHAPTER_PREFIX)
  ) {
    return resolved;
  }
  const chapter = kind === "bind" || kind === "server" ? lineOptionChapter(kind) : "";
  const variant = chapter ? keyword.variants?.find((item) => item.chapter === chapter) : undefined;
  if (!variant) {
    return resolved;
  }
  return {
    name: keyword.name,
    sections: variant.sections.length > 0 ? variant.sections : keyword.sections,
    signatures: variant.signatures.length > 0 ? variant.signatures : keyword.signatures,
    sources: keyword.sources,
    contexts: variant.contexts?.length ? variant.contexts : keyword.contexts,
    arguments: variant.arguments?.length ? variant.arguments : keyword.arguments,
    argument_model: variant.argument_model ?? keyword.argument_model,
    chapter: variant.chapter,
  };
}

export function resolveNestedOptionKeyword(
  schema: HaproxySchema,
  section: string | null,
  ruleKind: string,
  option: string,
): ResolvedSchemaKeyword | undefined {
  return resolveLineOptionSchemaKeyword(schema, option, ruleKind, section);
}
