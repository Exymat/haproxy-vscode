import { bench, describe } from "vitest";

import { provideDocumentSymbols } from "../../src/documentSymbols";
import { missingReferenceDiagnostics } from "../../src/missingReferenceDiagnostics";
import { provideDefinition, provideReferences } from "../../src/navigation";
import { getSymbolIndex } from "../../src/symbolIndex";
import { loadSchemaBundle } from "../helpers/schema";
import { createDocument } from "../helpers/document";
import { BENCH_LARGE_MAX_LINES, findLineContaining, readFixture } from "./helpers";

const bundle = loadSchemaBundle("3.2");
const largeContent = readFixture("large-valid.cfg", "bench");
const largeDoc = createDocument(largeContent);
const largeDefaultBackendLine = findLineContaining(largeContent, "default_backend bench_api_0000");
const largeCacheUseLine = findLineContaining(largeContent, "http-request cache-use bench_cache");
const largeResolversLine = findLineContaining(
  largeContent,
  "server-template srv 3 bench-api-0000.service.local",
);
const largeInlineAclLine = findLineContaining(largeContent, "use_backend bench_api_0000 if is_api");
const largePeersLine = findLineContaining(largeContent, "peers bench_peers");

const navigationContent = [
  "backend api",
  "    server s1 127.0.0.1:8080",
  "frontend web",
  "    use_backend api",
].join("\n");

const cacheNavigationContent = [
  "cache bench_cache",
  "    total-max-size 4",
  "frontend web",
  "    http-request cache-use bench_cache",
].join("\n");

const resolversNavigationContent = [
  "resolvers bench_dns",
  "    nameserver ns1 10.0.0.1:53",
  "backend api",
  "    server s1 host.local:80 check resolvers bench_dns",
].join("\n");

const inlineAclNavigationContent = [
  "frontend web",
  "    acl is_api path_beg /api",
  "    http-request deny if { is_api }",
].join("\n");

const peersNavigationContent = [
  "peers bench_peers",
  "    peer p1 127.0.0.1:10000",
  "frontend web",
  "    bind :80",
].join("\n");

describe("navigation", () => {
  bench("definition: use_backend reference", () => {
    const doc = createDocument(navigationContent);
    const line = 3;
    const character = "    use_backend api".indexOf("api");
    provideDefinition(doc, { line, character } as never, bundle.schema, BENCH_LARGE_MAX_LINES);
  });

  bench("references: use_backend declaration", () => {
    const doc = createDocument(navigationContent);
    const line = 3;
    const character = "    use_backend api".indexOf("api");
    provideReferences(
      doc,
      { line, character } as never,
      { includeDeclaration: true },
      bundle.schema,
      BENCH_LARGE_MAX_LINES,
    );
  });

  bench("definition: cache-use reference", () => {
    const doc = createDocument(cacheNavigationContent);
    const line = 3;
    const character = "    http-request cache-use bench_cache".indexOf("bench_cache");
    provideDefinition(doc, { line, character } as never, bundle.schema, BENCH_LARGE_MAX_LINES);
  });

  bench("definition: resolvers on server line", () => {
    const doc = createDocument(resolversNavigationContent);
    const line = 3;
    const character = "    server s1 host.local:80 check resolvers bench_dns".indexOf("bench_dns");
    provideDefinition(doc, { line, character } as never, bundle.schema, BENCH_LARGE_MAX_LINES);
  });

  bench("definition: inline ACL reference", () => {
    const doc = createDocument(inlineAclNavigationContent);
    const line = 2;
    const character = "    http-request deny if { is_api }".indexOf("is_api");
    provideDefinition(doc, { line, character } as never, bundle.schema, BENCH_LARGE_MAX_LINES);
  });

  bench("references: peers section definition", () => {
    const doc = createDocument(peersNavigationContent);
    const line = 0;
    const character = "peers bench_peers".indexOf("bench_peers");
    provideReferences(
      doc,
      { line, character } as never,
      { includeDeclaration: true },
      bundle.schema,
      BENCH_LARGE_MAX_LINES,
    );
  });

  bench("document symbols: sample.cfg", () => {
    const doc = createDocument(readFixture("sample.cfg", "integration"));
    provideDocumentSymbols(doc);
  });

  bench("document symbols: large-valid.cfg", () => {
    provideDocumentSymbols(largeDoc);
  });

  bench(
    "definition warm: large-valid.cfg default_backend",
    () => {
      const target = "bench_api_0000";
      const character = largeContent.split(/\r?\n/)[largeDefaultBackendLine].indexOf(target);
      for (let i = 0; i < 50; i += 1) {
        provideDefinition(
          largeDoc,
          { line: largeDefaultBackendLine, character } as never,
          bundle.schema,
          BENCH_LARGE_MAX_LINES,
        );
      }
    },
    { time: 500, warmupIterations: 3 },
  );

  bench("definition: large-valid.cfg cache-use", () => {
    const character = largeContent.split(/\r?\n/)[largeCacheUseLine].indexOf("bench_cache");
    provideDefinition(
      largeDoc,
      { line: largeCacheUseLine, character } as never,
      bundle.schema,
      BENCH_LARGE_MAX_LINES,
    );
  });

  bench("definition: large-valid.cfg resolvers", () => {
    const character = largeContent.split(/\r?\n/)[largeResolversLine].indexOf("bench_dns");
    provideDefinition(
      largeDoc,
      { line: largeResolversLine, character } as never,
      bundle.schema,
      BENCH_LARGE_MAX_LINES,
    );
  });

  bench("definition: large-valid.cfg inline ACL", () => {
    const character = largeContent.split(/\r?\n/)[largeInlineAclLine].indexOf("is_api");
    provideDefinition(
      largeDoc,
      { line: largeInlineAclLine, character } as never,
      bundle.schema,
      BENCH_LARGE_MAX_LINES,
    );
  });

  bench("references: large-valid.cfg peers section", () => {
    const character = largeContent.split(/\r?\n/)[largePeersLine].indexOf("bench_peers");
    provideReferences(
      largeDoc,
      { line: largePeersLine, character } as never,
      { includeDeclaration: true },
      bundle.schema,
      BENCH_LARGE_MAX_LINES,
    );
  });

  bench("missing references warm: large-valid.cfg", () => {
    const index = getSymbolIndex(largeDoc, bundle.schema, BENCH_LARGE_MAX_LINES);
    if (index) {
      missingReferenceDiagnostics(index, bundle.schema);
    }
  });

  bench(
    "definition warm: large-valid.cfg inline ACL",
    () => {
      const character = largeContent.split(/\r?\n/)[largeInlineAclLine].indexOf("is_api");
      for (let i = 0; i < 50; i += 1) {
        provideDefinition(
          largeDoc,
          { line: largeInlineAclLine, character } as never,
          bundle.schema,
          BENCH_LARGE_MAX_LINES,
        );
      }
    },
    { time: 500, warmupIterations: 3 },
  );
});
