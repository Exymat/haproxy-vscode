import { getKeywordFromSchema } from "./directiveUtils";
import { ArgumentModel, HaproxySchema, LineOptionSemantic } from "./schema";
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

function argumentModelSlotCount(model: ArgumentModel): number {
  return model.slots.length;
}

function chapterResolvedKeyword(
  schema: HaproxySchema,
  option: string,
  chapter: string,
): ResolvedSchemaKeyword | undefined {
  const keyword = schema.keywords[option];
  const variant = keyword?.variants?.find((item) => item.chapter === chapter);
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
    sections: variant.sections.length > 0 ? variant.sections : keyword.sections,
    signatures: useTopLevelModel
      ? keyword.signatures
      : variant.signatures.length > 0
        ? variant.signatures
        : keyword.signatures,
    sources: keyword.sources,
    contexts: variant.contexts?.length ? variant.contexts : keyword.contexts,
    arguments: useTopLevelModel
      ? keyword.arguments
      : variant.arguments?.length
        ? variant.arguments
        : keyword.arguments,
    argument_model: useTopLevelModel ? topModel : variantModel,
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
  return getKeywordFromSchema(schema, option, section);
}

export function resolveNestedOptionKeyword(
  schema: HaproxySchema,
  section: string | null,
  ruleKind: string,
  option: string,
): ResolvedSchemaKeyword | undefined {
  return resolveLineOptionSchemaKeyword(schema, option, ruleKind, section);
}
