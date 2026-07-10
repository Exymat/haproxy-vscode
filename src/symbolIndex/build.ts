import { ParsedLine } from "../parser";
import { HaproxySchema } from "../schema/types";

import { aclReferenceAt } from "./aclReferences";
import { createSymbolBuildContext, SymbolBuildContext } from "./context";
import { collectLineSitesInto } from "./lineSites";
import { buildScopeKeyByLine, updateScopeKeyForLine } from "./scope";
import { proxySectionSet, SymbolIndex, SymbolSite } from "./types";
import { addSite, buildReferencesByKey, buildSitesByLine, ensureSitesByLine } from "./utils";

export interface SymbolIndexBuildOptions {
  /** When false, returns empty fingerprint slots without per-line hashing. */
  computeFingerprints?: boolean;
  /** When false, defers sitesByLine until navigation lookup. */
  buildSitesByLine?: boolean;
}

/** Collect definition/reference sites contributed by a single parsed line. */
export function collectLineSymbolSites(
  line: ParsedLine,
  schema: HaproxySchema,
  scopeKey: string | null,
  buildContext?: SymbolBuildContext,
): SymbolSite[] {
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const context = buildContext ?? createSymbolBuildContext(schema);

  collectLineSitesInto(line, schema, scopeKey, definitions, references, context);

  const sites: SymbolSite[] = [...references];
  for (const defs of definitions.values()) {
    sites.push(...defs);
  }
  return sites;
}

/** Stable fingerprint of symbol names/roles/ranges on a line. */
export function symbolSiteFingerprint(sites: SymbolSite[]): string {
  if (sites.length === 0) {
    return "";
  }
  const fingerprintPart = (site: SymbolSite) =>
    `${site.role}:${site.kind}:${site.scopeKey ?? ""}:${site.name.toLowerCase()}:${site.start}:${site.end}`;
  if (sites.length === 1) {
    return fingerprintPart(sites[0]);
  }
  const parts = sites.map((site) => fingerprintPart(site));
  parts.sort();
  return parts.join("\0");
}

export interface SymbolIndexBuildResult {
  index: SymbolIndex;
  lineFingerprints: string[];
}

function collectUnresolvedReferences(
  definitions: Map<string, SymbolSite[]>,
  referencesByKey: Map<string, SymbolSite[]>,
): SymbolSite[] {
  const unresolved: SymbolSite[] = [];

  for (const [key, refs] of referencesByKey) {
    if (refs.every((ref) => ref.kind === "environment-variable")) {
      continue;
    }
    if (definitions.has(key)) {
      continue;
    }
    unresolved.push(...refs);
  }

  return unresolved;
}

export function buildSymbolIndexWithFingerprints(
  parsed: ParsedLine[],
  schema: HaproxySchema,
  options: SymbolIndexBuildOptions = {},
): SymbolIndexBuildResult {
  const computeFingerprints = options.computeFingerprints !== false;
  const buildSitesByLineNow = options.buildSitesByLine !== false;
  const definitions = new Map<string, SymbolSite[]>();
  const references: SymbolSite[] = [];
  const lineFingerprints: string[] = Array.from({ length: parsed.length }, () => "");
  const scopeKeyByLine: (string | null)[] = Array.from({ length: parsed.length }, () => null);
  const buildContext = createSymbolBuildContext(schema);
  const proxySections = proxySectionSet(schema);
  const scopeState = { currentScopeKey: null as string | null };

  for (const line of parsed) {
    const scopeKey = updateScopeKeyForLine(line, proxySections, scopeState);
    scopeKeyByLine[line.line] = scopeKey;

    if (computeFingerprints) {
      const sites = collectLineSymbolSites(line, schema, scopeKey, buildContext);
      lineFingerprints[line.line] = symbolSiteFingerprint(sites);
      for (const site of sites) {
        addSite(buildContext.scopedSymbolKinds, definitions, references, site);
      }
      continue;
    }

    collectLineSitesInto(line, schema, scopeKey, definitions, references, buildContext);
  }

  const referencesByKey = buildReferencesByKey(buildContext.scopedSymbolKinds, references);

  const index: SymbolIndex = {
    definitions,
    references,
    referencesByKey,
    scopeKeyByLine,
    scopedSymbolKinds: buildContext.scopedSymbolKinds,
    sitesByLine: buildSitesByLineNow
      ? buildSitesByLine(parsed.length, definitions, references)
      : [],
    unresolvedReferences: collectUnresolvedReferences(definitions, referencesByKey),
  };

  return { index, lineFingerprints };
}

export function buildLineFingerprints(parsed: ParsedLine[], schema: HaproxySchema): string[] {
  return buildSymbolIndexWithFingerprints(parsed, schema).lineFingerprints;
}

export function buildSymbolIndex(parsed: ParsedLine[], schema: HaproxySchema): SymbolIndex {
  return buildSymbolIndexWithFingerprints(parsed, schema).index;
}

export function patchSymbolIndexLine(
  index: SymbolIndex,
  line: ParsedLine,
  sites: SymbolSite[],
  buildContext: SymbolBuildContext,
): SymbolIndexBuildResult {
  const definitions = new Map<string, SymbolSite[]>();
  for (const [key, defs] of index.definitions) {
    const filtered = defs.filter((entry) => entry.line !== line.line);
    if (filtered.length > 0) {
      definitions.set(key, filtered);
    }
  }

  const references = index.references.filter((entry) => entry.line !== line.line);
  ensureSitesByLine(index);
  const sitesByLine = index.sitesByLine.slice();

  for (const site of sites) {
    addSite(buildContext.scopedSymbolKinds, definitions, references, site);
  }
  sitesByLine[line.line] = [...sites];

  const referencesByKey = buildReferencesByKey(buildContext.scopedSymbolKinds, references);

  const patched: SymbolIndex = {
    definitions,
    references,
    referencesByKey,
    scopeKeyByLine: index.scopeKeyByLine,
    scopedSymbolKinds: buildContext.scopedSymbolKinds,
    sitesByLine,
    unresolvedReferences: collectUnresolvedReferences(definitions, referencesByKey),
  };

  return { index: patched, lineFingerprints: [symbolSiteFingerprint(sites)] };
}

export { buildScopeKeyByLine };
export { aclReferenceAt, createSymbolBuildContext };
export type { SymbolBuildContext };
