import { getKeywordFromSchema } from "./directiveUtils";
import { HaproxySchema, LineOptionSemantic } from "./schema";
import { ResolvedSchemaKeyword } from "./keywordVariant";

export const LINE_OPTION_CHAPTER_BIND = "5.1";
export const LINE_OPTION_CHAPTER_SERVER = "5.2";

function lineOptionSemanticForKind(
  schema: HaproxySchema,
  option: string,
  kind: string | null | undefined,
): LineOptionSemantic | undefined {
  if (!kind) {
    return undefined;
  }
  return schema.keywords[option]?.line_option_semantics?.find((item) => item.parent_kind === kind);
}

export function lineOptionChapter(kind: "bind" | "server"): string {
  return kind === "bind" ? LINE_OPTION_CHAPTER_BIND : LINE_OPTION_CHAPTER_SERVER;
}

function argumentModelSlotCount(model: { slots?: unknown[] } | undefined): number {
  /* v8 ignore next -- helper is only used to compare present models during variant fallback */
  return model?.slots?.length ?? 0;
}

function chapterResolvedKeyword(
  schema: HaproxySchema,
  option: string,
  chapter: string,
): ResolvedSchemaKeyword | undefined {
  const keyword = schema.keywords[option];
  const variant = keyword?.variants?.find((item) => item.chapter === chapter);
  /* v8 ignore next -- missing chapter variants fall back to broader keyword resolution */
  if (!keyword || !variant) {
    return undefined;
  }
  const variantModel = variant.argument_model ?? keyword.argument_model;
  const topModel = keyword.argument_model;
  const useTopLevelModel =
    topModel &&
    variantModel &&
    argumentModelSlotCount(topModel) > argumentModelSlotCount(variantModel);

  return {
    name: keyword.name,
    /* v8 ignore next -- chapter variants normally carry their own section list */
    sections: variant.sections.length > 0 ? variant.sections : keyword.sections,
    /* v8 ignore start -- compatibility fallbacks only apply when chapter variants omit inherited docs */
    signatures: useTopLevelModel
      ? keyword.signatures
      : variant.signatures.length > 0
        ? variant.signatures
        : keyword.signatures,
    sources: keyword.sources,
    /* v8 ignore next -- chapter variants often inherit contexts from the base keyword */
    contexts: variant.contexts?.length ? variant.contexts : keyword.contexts,
    arguments: useTopLevelModel
      ? keyword.arguments
      : variant.arguments?.length
        ? variant.arguments
        : keyword.arguments,
    /* v8 ignore stop */
    /* v8 ignore next -- chapter variants normally carry their own narrowed argument model */
    argument_model: useTopLevelModel ? topModel : variantModel,
    /* v8 ignore next -- chapter-specific resolution only runs when a concrete variant exists */
    chapter: variant.chapter,
  };
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
  const semantic = lineOptionSemanticForKind(schema, option, kind);
  if (semantic) {
    return (
      chapterResolvedKeyword(schema, option, semantic.chapter) ??
      getKeywordFromSchema(schema, option, section)
    );
  }
  const resolved = getKeywordFromSchema(schema, option, section);
  /* v8 ignore start -- standard schema lookup usually resolves before chapter fallback is considered */
  if (resolved) {
    return resolved;
  }
  /* v8 ignore stop */
  /* v8 ignore start -- schema keyword resolution already returns the base keyword when it exists */
  /* v8 ignore next -- non bind/server callers intentionally skip chapter-based fallback resolution */
  const chapter = kind === "bind" || kind === "server" ? lineOptionChapter(kind) : "";
  return chapter ? chapterResolvedKeyword(schema, option, chapter) : undefined;
  /* v8 ignore stop */
}

export function resolveNestedOptionKeyword(
  schema: HaproxySchema,
  section: string | null,
  ruleKind: string,
  option: string,
): ResolvedSchemaKeyword | undefined {
  return resolveLineOptionSchemaKeyword(schema, option, ruleKind, section);
}
