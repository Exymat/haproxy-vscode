import {
  LanguageArgumentParam,
  LanguageExample,
  LanguageKeyword,
  LanguageKeywordVariant,
} from "./languageData";
import { SchemaKeyword, SchemaKeywordVariant } from "./schema";

const languageResolutionCache = new WeakMap<
  LanguageKeyword,
  Map<string, ResolvedLanguageKeyword>
>();
const schemaResolutionCache = new WeakMap<SchemaKeyword, Map<string, ResolvedSchemaKeyword>>();

function resolutionCacheKey(section: string | null | undefined): string {
  return section ?? "";
}

function cachedResolution<K extends object, V>(
  cache: WeakMap<K, Map<string, V>>,
  keyword: K,
  section: string | null | undefined,
  build: () => V,
): V {
  const key = resolutionCacheKey(section);
  let perKeyword = cache.get(keyword);
  if (!perKeyword) {
    perKeyword = new Map();
    cache.set(keyword, perKeyword);
  }
  const cached = perKeyword.get(key);
  if (cached) {
    return cached;
  }
  const resolved = build();
  perKeyword.set(key, resolved);
  return resolved;
}

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

function resolveWithVariants<
  TKeyword extends {
    name: string;
    sections: string[];
    signatures: string[];
    variants?: TVariant[];
  },
  TVariant extends { sections: string[]; signatures: string[]; chapter?: string },
  TResolved,
>(
  keyword: TKeyword | undefined,
  section: string | null | undefined,
  cache: WeakMap<object, Map<string, TResolved>>,
  buildFromVariant: (keyword: TKeyword, variant: TVariant) => TResolved,
  buildFromBase: (keyword: TKeyword) => TResolved,
): TResolved | undefined {
  if (!keyword) {
    return undefined;
  }
  return cachedResolution(cache, keyword, section, () => {
    const variant =
      pickVariantBySection(keyword.variants ?? [], section) ??
      preferredVariant(keyword.variants ?? []);
    if (variant) {
      return buildFromVariant(keyword, variant);
    }
    return buildFromBase(keyword);
  });
}

export function resolveLanguageKeyword(
  keyword: LanguageKeyword | undefined,
  section: string | null | undefined,
): ResolvedLanguageKeyword | undefined {
  return resolveWithVariants(
    keyword,
    section,
    languageResolutionCache,
    (base, variant) => {
      const languageVariant = variant as LanguageKeywordVariant;
      const variantArguments = effectiveLanguageArguments(base, languageVariant);
      const examples = languageVariant.examples?.length
        ? languageVariant.examples
        : base.examples?.length
          ? base.examples
          : undefined;
      return {
        name: base.name,
        sections: languageVariant.sections.length > 0 ? languageVariant.sections : base.sections,
        signatures:
          languageVariant.signatures.length > 0 ? languageVariant.signatures : base.signatures,
        description: languageVariant.description,
        docsUrl: languageVariant.docsUrl,
        arguments: variantArguments,
        contexts: languageVariant.contexts?.length ? languageVariant.contexts : undefined,
        chapter: languageVariant.chapter,
        examples,
      };
    },
    (base) => ({
      name: base.name,
      sections: base.sections,
      signatures: base.signatures,
      description: base.description,
      docsUrl: base.docsUrl,
      arguments: base.arguments,
      examples: base.examples,
    }),
  );
}

export function resolveSchemaKeyword(
  keyword: SchemaKeyword | undefined,
  section: string | null | undefined,
): ResolvedSchemaKeyword | undefined {
  return resolveWithVariants(
    keyword,
    section,
    schemaResolutionCache,
    (base, variant) => {
      const schemaVariant = variant as SchemaKeywordVariant;
      const variantArguments = effectiveSchemaArguments(base, schemaVariant);
      const variantModel = schemaVariant.argument_model ?? base.argument_model;
      return {
        name: base.name,
        sections: schemaVariant.sections.length > 0 ? schemaVariant.sections : base.sections,
        signatures:
          schemaVariant.signatures.length > 0 ? schemaVariant.signatures : base.signatures,
        sources: base.sources,
        contexts: schemaVariant.contexts?.length ? schemaVariant.contexts : base.contexts,
        arguments: variantArguments,
        argument_model: variantModel,
        chapter: schemaVariant.chapter,
      };
    },
    (base) => ({
      name: base.name,
      sections: base.sections,
      signatures: base.signatures,
      sources: base.sources,
      contexts: base.contexts,
      arguments: base.arguments,
      argument_model: base.argument_model,
    }),
  );
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
