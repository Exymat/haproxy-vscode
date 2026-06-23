import {
  LanguageArgumentParam,
  LanguageExample,
  LanguageKeyword,
  LanguageKeywordVariant,
} from "./languageData";
import { SchemaKeyword, SchemaKeywordVariant } from "./schema";

function effectiveLanguageArguments(
  keyword: LanguageKeyword,
  variant: LanguageKeywordVariant,
): LanguageArgumentParam[] | undefined {
  if (
    variant.arguments?.length &&
    variant.arguments.some(
      (param) => param.description || param.values.some((value) => value.description),
    )
  ) {
    return variant.arguments;
  }
  if (keyword.arguments?.length) {
    return keyword.arguments;
  }
  return variant.arguments;
}

function effectiveSchemaArguments(
  keyword: SchemaKeyword,
  variant: SchemaKeywordVariant,
): SchemaKeyword["arguments"] {
  if (
    variant.arguments?.length &&
    variant.arguments.some(
      (param) => param.description || param.values.some((value) => value.description),
    )
  ) {
    return variant.arguments;
  }
  if (keyword.arguments?.length) {
    return keyword.arguments;
  }
  return variant.arguments;
}

export interface ResolvedLanguageKeyword {
  name: string;
  sections: string[];
  signatures: string[];
  description: string;
  docsUrl: string;
  arguments?: LanguageArgumentParam[];
  contexts?: string[];
  chapter?: string;
  examples?: LanguageExample[];
}

export interface ResolvedSchemaKeyword {
  name: string;
  sections: string[];
  signatures: string[];
  sources: string[];
  contexts?: string[];
  arguments?: SchemaKeyword["arguments"];
  argument_model?: SchemaKeyword["argument_model"];
  chapter?: string;
}

function pickVariantBySection<T extends { sections: string[] }>(
  variants: T[],
  section: string | null | undefined,
): T | undefined {
  if (!variants.length) {
    return undefined;
  }
  if (section) {
    const exact = variants.filter((variant) => variant.sections.includes(section));
    if (exact.length === 1) {
      return exact[0];
    }
    if (exact.length > 1) {
      return exact.sort((left, right) => left.sections.length - right.sections.length)[0];
    }
  }
  return variants.length === 1 ? variants[0] : undefined;
}

function preferredVariant<T extends { chapter?: string }>(variants: T[]): T | undefined {
  if (!variants.length) {
    return undefined;
  }
  for (const chapter of ["4.2", "3.1", "3.2", "3.3"]) {
    const hit = variants.find((variant) => variant.chapter === chapter);
    if (hit) {
      return hit;
    }
  }
  return variants[0];
}

export function resolveLanguageKeyword(
  keyword: LanguageKeyword | undefined,
  section: string | null | undefined,
): ResolvedLanguageKeyword | undefined {
  if (!keyword) {
    return undefined;
  }
  const variant =
    pickVariantBySection(keyword.variants ?? [], section) ??
    preferredVariant(keyword.variants ?? []);
  if (variant) {
    const variantArguments = effectiveLanguageArguments(keyword, variant);
    const examples = variant.examples?.length
      ? variant.examples
      : keyword.examples?.length
        ? keyword.examples
        : undefined;
    return {
      name: keyword.name,
      sections: variant.sections.length > 0 ? variant.sections : keyword.sections,
      signatures: variant.signatures.length > 0 ? variant.signatures : keyword.signatures,
      description: variant.description,
      docsUrl: variant.docsUrl,
      arguments: variantArguments,
      contexts: variant.contexts?.length ? variant.contexts : undefined,
      chapter: variant.chapter,
      examples,
    };
  }
  return {
    name: keyword.name,
    sections: keyword.sections,
    signatures: keyword.signatures,
    description: keyword.description,
    docsUrl: keyword.docsUrl,
    arguments: keyword.arguments,
    examples: keyword.examples,
  };
}

export function resolveSchemaKeyword(
  keyword: SchemaKeyword | undefined,
  section: string | null | undefined,
): ResolvedSchemaKeyword | undefined {
  if (!keyword) {
    return undefined;
  }
  const variant =
    pickVariantBySection(keyword.variants ?? [], section) ??
    preferredVariant(keyword.variants ?? []);
  if (variant) {
    const variantArguments = effectiveSchemaArguments(keyword, variant);
    const variantModel = variant.argument_model ?? keyword.argument_model;
    return {
      name: keyword.name,
      sections: variant.sections.length > 0 ? variant.sections : keyword.sections,
      signatures: variant.signatures.length > 0 ? variant.signatures : keyword.signatures,
      sources: keyword.sources,
      contexts: variant.contexts?.length ? variant.contexts : keyword.contexts,
      arguments: variantArguments,
      argument_model: variantModel,
      chapter: variant.chapter,
    };
  }
  return {
    name: keyword.name,
    sections: keyword.sections,
    signatures: keyword.signatures,
    sources: keyword.sources,
    contexts: keyword.contexts,
    arguments: keyword.arguments,
    argument_model: keyword.argument_model,
  };
}

export function languageVariantForSection(
  keyword: LanguageKeyword,
  section: string | null | undefined,
): LanguageKeywordVariant | undefined {
  return (
    pickVariantBySection(keyword.variants ?? [], section) ??
    preferredVariant(keyword.variants ?? [])
  );
}

export function schemaVariantForSection(
  keyword: SchemaKeyword,
  section: string | null | undefined,
): SchemaKeywordVariant | undefined {
  return (
    pickVariantBySection(keyword.variants ?? [], section) ??
    preferredVariant(keyword.variants ?? [])
  );
}
