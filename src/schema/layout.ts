import {
  logFormatDirectiveKeywordCache,
  prefixFamilyCache,
  sectionHeaderSetCache,
  sortedSectionHeaderCache,
  statsSocketLevelCache,
  tcpRequestPhaseCache,
  tcpResponsePhaseCache,
} from "./cache";
import { buildPrefixSubcommands } from "./keywords";
import type { HaproxySchema } from "./types";

export function prefixFamilies(schema: HaproxySchema): string[] {
  return schema.line_layout?.prefix_families ?? [];
}

export function prefixFamilySet(schema: HaproxySchema): Set<string> {
  const cached = prefixFamilyCache.get(schema);
  if (cached) {
    return cached;
  }
  const result = new Set(prefixFamilies(schema).map((value) => value.toLowerCase()));
  prefixFamilyCache.set(schema, result);
  return result;
}

export function tcpRulePhaseSet(
  schema: HaproxySchema,
  kind: "tcp-request" | "tcp-response",
): Set<string> {
  const cache = kind === "tcp-request" ? tcpRequestPhaseCache : tcpResponsePhaseCache;
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const fromLayout =
    kind === "tcp-request"
      ? schema.line_layout?.tcp_request_phases
      : schema.line_layout?.tcp_response_phases;
  const result = fromLayout
    ? new Set(fromLayout.map((v) => v.toLowerCase()))
    : buildPrefixSubcommands(Object.keys(schema.keywords), kind);
  cache.set(schema, result);
  return result;
}

export function tcpRequestPhaseSet(schema: HaproxySchema): Set<string> {
  return tcpRulePhaseSet(schema, "tcp-request");
}

export function tcpResponsePhaseSet(schema: HaproxySchema): Set<string> {
  return tcpRulePhaseSet(schema, "tcp-response");
}

export function statsSocketLevelSet(schema: HaproxySchema): Set<string> {
  const cached = statsSocketLevelCache.get(schema);
  if (cached) {
    return cached;
  }
  const levels = schema.line_layout?.stats_socket_levels ?? [];
  const result = new Set(levels.map((v) => v.toLowerCase()));
  statsSocketLevelCache.set(schema, result);
  return result;
}

export function sectionNames(schema: HaproxySchema): string[] {
  return Object.keys(schema.sections).sort();
}

export function sectionHeaderSet(schema: HaproxySchema): Set<string> {
  const cached = sectionHeaderSetCache.get(schema);
  if (cached) {
    return cached;
  }
  const fromLayout = schema.line_layout?.section_headers;
  const headers =
    fromLayout && fromLayout.length > 0
      ? [...new Set([...fromLayout, ...sectionNames(schema)])]
      : sectionNames(schema);
  const set = new Set(headers.map((header) => header.toLowerCase()));
  sectionHeaderSetCache.set(schema, set);
  return set;
}

export function sortedSectionHeaders(schema: HaproxySchema): string[] {
  const cached = sortedSectionHeaderCache.get(schema);
  if (cached) {
    return cached;
  }
  const sorted = [...sectionHeaderSet(schema)].sort();
  sortedSectionHeaderCache.set(schema, sorted);
  return sorted;
}

export function logFormatDirectiveKeywordSet(schema: HaproxySchema): Set<string> {
  const cached = logFormatDirectiveKeywordCache.get(schema);
  if (cached) {
    return cached;
  }
  const keywords = new Set<string>();
  for (const slot of schema.logformat_slots ?? []) {
    if (slot.directive) {
      keywords.add(slot.directive.toLowerCase());
    }
  }
  logFormatDirectiveKeywordCache.set(schema, keywords);
  return keywords;
}
