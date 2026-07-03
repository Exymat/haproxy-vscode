import {
  enumDescriptionsForKeyword,
  enumNamesForArgumentPosition,
  EnumValue,
  filterDirectiveKeywordParts,
  mergeEnumValues,
} from "./argumentEnumUtils";
import { HaproxyLanguageData, LanguageArgumentParam } from "./languageData";
import {
  ResolvedLanguageKeyword,
  ResolvedSchemaKeyword,
  resolveLanguageKeyword,
  resolveSchemaKeyword,
} from "./keywordVariant";
import { ParsedLine } from "./parser";
import { HaproxySchema } from "./schema";
import { isAddressOrPathToken, resolveLongestDirectiveMatch } from "./tokenUtils";

export interface ResolvedDirective {
  keyword: string;
  start: number;
  end: number;
  matched: boolean;
}

export function resolveDirective(
  line: ParsedLine,
  allowed: Set<string>,
  options?: { noPrefixKeywords?: Set<string>; modifierPrefixes?: Set<string> },
): ResolvedDirective {
  const match = resolveLongestDirectiveMatch(
    line,
    allowed,
    4,
    options?.noPrefixKeywords,
    options?.modifierPrefixes,
  );
  return {
    keyword: match.keyword,
    start: match.start,
    end: match.end,
    matched: match.matched,
  };
}

export function conditionalStartIndex(line: ParsedLine, afterDirective: number): number {
  for (let i = line.tokens.length - 1; i > afterDirective; i -= 1) {
    const lower = line.tokens[i].text.toLowerCase();
    if (lower === "if" || lower === "unless") {
      return i;
    }
  }
  return line.tokens.length;
}

export function argumentTokenIndices(line: ParsedLine, directiveEnd: number): number[] {
  const end = conditionalStartIndex(line, directiveEnd);
  const indices: number[] = [];
  for (let i = directiveEnd + 1; i < end; i += 1) {
    indices.push(i);
  }
  return indices;
}

export function argumentPosition(tokenIndex: number, directiveEnd: number): number {
  return Math.max(0, tokenIndex - directiveEnd - 1);
}

function normalizeValueName(token: string): string {
  const paren = token.indexOf("(");
  return (paren >= 0 ? token.slice(0, paren) : token).toLowerCase();
}

export function findArgumentValue(
  params: LanguageArgumentParam[] | undefined,
  tokenText: string,
): { name: string; description: string; parameter: string } | undefined {
  if (!params) {
    return undefined;
  }
  const key = normalizeValueName(tokenText);
  let fallback:
    | {
        name: string;
        description: string;
        parameter: string;
      }
    | undefined;
  for (const param of params) {
    for (const value of param.values) {
      if (normalizeValueName(value.name) !== key) {
        continue;
      }
      const hit = { name: value.name, description: value.description, parameter: param.parameter };
      if (value.description.trim()) {
        return hit;
      }
      fallback ??= hit;
    }
  }
  return fallback;
}

export function isEnumPerParameter(params: LanguageArgumentParam[] | undefined): boolean {
  if (!params || params.length <= 1) {
    return false;
  }
  return params.every(
    (param) =>
      param.values.length === 1 &&
      param.values[0].name.toLowerCase() === param.parameter.toLowerCase(),
  );
}

export function documentedEnumValueNames(
  langKw: ResolvedLanguageKeyword | undefined,
  schemaKw?: ResolvedSchemaKeyword,
): string[] {
  if (isEnumPerParameter(langKw?.arguments)) {
    return allArgumentValues(langKw?.arguments).map((value) => value.name);
  }
  const fromSchema = enumNamesForArgumentPosition(schemaKw, langKw, 0);
  if (fromSchema.length > 0) {
    return fromSchema;
  }
  const single = langKw?.arguments?.[0];
  if (single && single.values.length >= 2) {
    return single.values.map((value) => value.name);
  }
  return [];
}

export function completionValuesForPosition(
  schemaKw: ResolvedSchemaKeyword | undefined,
  langKw: ResolvedLanguageKeyword | undefined,
  position: number,
  line: ParsedLine,
  directiveEnd: number,
  directiveKeyword: string,
): EnumValue[] {
  const langValues = filterDirectiveKeywordParts(
    argumentValuesForPosition(langKw?.arguments, position, line, directiveEnd).map((value) => ({
      name: value.name,
      description: value.description,
    })),
    directiveKeyword,
  );
  const schemaNames = enumNamesForArgumentPosition(schemaKw, langKw, position);
  const descriptions = enumDescriptionsForKeyword(langKw, schemaKw);
  return filterDirectiveKeywordParts(
    mergeEnumValues(
      langValues,
      schemaNames.length > 0 || langValues.length > 0
        ? schemaNames
        : fallbackSchemaEnumNamesForPackedValueSlot(schemaKw, langKw, position, line, directiveEnd),
      descriptions,
    ),
    directiveKeyword,
  );
}

function fallbackSchemaEnumNamesForPackedValueSlot(
  schemaKw: ResolvedSchemaKeyword | undefined,
  langKw: ResolvedLanguageKeyword | undefined,
  position: number,
  line: ParsedLine,
  directiveEnd: number,
): string[] {
  const slots = schemaKw?.argument_model?.slots ?? [];
  const slot = slots[position];
  if (!slot?.optional || slot.value_kind !== "generic" || (slot.enum?.length ?? 0) > 0) {
    return [];
  }
  const previousArg = line.tokens[directiveEnd + position]?.text ?? "";
  if (!isAddressOrPathToken(previousArg)) {
    return [];
  }

  for (let next = position + 1; next < slots.length; next += 1) {
    const names = enumNamesForArgumentPosition(schemaKw, langKw, next);
    if (names.length > 0) {
      return names;
    }
    const nextSlot = slots[next];
    if (!nextSlot?.optional) {
      break;
    }
  }

  return [];
}

export function argumentValuesForPosition(
  params: LanguageArgumentParam[] | undefined,
  position: number,
  line: ParsedLine,
  directiveEnd: number,
): LanguageArgumentParam["values"] {
  if (!params || params.length === 0) {
    return [];
  }
  if (params.length === 1) {
    return params[0].values;
  }
  if (isEnumPerParameter(params)) {
    return allArgumentValues(params);
  }
  const firstArg = line.tokens[directiveEnd + 1]?.text.toLowerCase() ?? "";
  const urlParam = params.find((p) => p.parameter === "url_param");
  const algorithm = params.find((p) => p.parameter === "<algorithm>" || p.parameter === "");
  if (firstArg === "url_param" && urlParam) {
    return position <= 0
      ? [{ name: "url_param", description: urlParam.description }]
      : urlParam.values;
  }
  if (algorithm && algorithm.values.length > 0) {
    return algorithm.values;
  }
  const slot = params[Math.min(position, params.length - 1)];
  return slot?.values ?? [];
}

export function allArgumentValues(
  params: LanguageArgumentParam[] | undefined,
): LanguageArgumentParam["values"] {
  if (!params) {
    return [];
  }
  const seen = new Set<string>();
  const out: LanguageArgumentParam["values"] = [];
  for (const param of params) {
    for (const value of param.values) {
      const key = value.name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

export function getKeywordFromLanguage(
  data: HaproxyLanguageData,
  keyword: string,
  section?: string | null,
): ResolvedLanguageKeyword | undefined {
  return resolveLanguageKeyword(data.keywords[keyword.toLowerCase()], section);
}

export function getKeywordFromSchema(
  schema: HaproxySchema,
  keyword: string,
  section?: string | null,
): ResolvedSchemaKeyword | undefined {
  return resolveSchemaKeyword(schema.keywords[keyword.toLowerCase()], section);
}
