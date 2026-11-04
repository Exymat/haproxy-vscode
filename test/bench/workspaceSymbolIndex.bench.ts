import { describe, expect, test, vi } from "vitest";
import type { WorkspaceFolder } from "vscode";

import {
  buildWorkspaceSymbolIndexFromOpenDocuments as buildWorkspaceSymbolIndexFromOpenDocumentsImpl,
  fingerprintText as fingerprintTextImpl,
  clearWorkspaceSymbolIndex,
  getWorkspaceSymbolIndex,
  scheduleWorkspaceSymbolIndexRebuild,
  type WorkspaceSymbolSettings,
} from "../../src/symbolIndex";
import { getDiscoveredUris as getDiscoveredUrisImpl } from "../../src/symbolIndex/workspaceDiscovery";
import * as workspaceDocuments from "../../src/symbolIndex/workspaceDocuments";
import { loadDiskEntry as loadDiskEntryImpl } from "../../src/symbolIndex/workspaceDocuments";
import {
  resetVscodeMock,
  setMockWorkspaceFile,
  setMockWorkspaceFileStat,
  setMockWorkspaceFolders,
  Uri as UriImpl,
  workspace,
} from "../__mocks__/vscode";
import { createDocument as createDocumentImpl } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";
import { BENCH_LARGE_MAX_LINES as BENCH_LARGE_MAX_LINES_IMPL, readFixture } from "./helpers";

const buildWorkspaceSymbolIndexFromOpenDocuments = buildWorkspaceSymbolIndexFromOpenDocumentsImpl;
const fingerprintText = fingerprintTextImpl;
const getDiscoveredUris = getDiscoveredUrisImpl;
const loadDiskEntry = loadDiskEntryImpl;
const Uri = UriImpl;
const createDocument = createDocumentImpl;
const BENCH_LARGE_MAX_LINES = BENCH_LARGE_MAX_LINES_IMPL;

const bundle = loadSchemaBundle("3.2");
const manyCfgFileCount = 1000;
const mixedCfgFileCount = 1000;
const discoveryCfgFileCount = 1000;
const haproxyFileCountInMixedWorkspace = mixedCfgFileCount / 2;
const diskLargeCfgPath = "file:///workspace/haproxy/large-valid.cfg";
const diskOversizedCfgPath = "file:///workspace/haproxy/oversized.cfg";
const discoveryWorkspacePath = "file:///workspace/discovery";
const discoveryWorkspaceFolder: WorkspaceFolder = {
  uri: Uri.file(discoveryWorkspacePath) as unknown as WorkspaceFolder["uri"],
  name: "discovery",
  index: 0,
};
const discoveryWorkspaceFolderKey = discoveryWorkspacePath;
const largeCfgContent = readFixture("large-valid.cfg", "bench");
const largeCfgByteLength = new TextEncoder().encode(largeCfgContent).byteLength;
const diskReadLimits = {
  maxFileBytes: largeCfgByteLength + 1,
  maxLineBytes: 1_000_000,
};
const diskSkipLimits = {
  maxFileBytes: 1024,
  maxLineBytes: 1_000_000,
};
const discoverySettings: WorkspaceSymbolSettings = {
  enabled: true,
  include: ["**/*.cfg"],
  exclude: [],
  roots: [],
  maxFiles: Number.POSITIVE_INFINITY,
  maxTotalLines: Number.POSITIVE_INFINITY,
  maxFileBytes: Number.POSITIVE_INFINITY,
  maxTotalBytes: Number.POSITIVE_INFINITY,
  maxLineBytes: Number.POSITIVE_INFINITY,
  debounceMs: 0,
};

function haproxySplitContent(i: number): string {
  const name = `api_${String(i).padStart(4, "0")}`;
  return i % 2 === 0
    ? `frontend web_${i}\n    acl route_${i} path_beg /tenant/${i}\n    use_backend ${name} if route_${i}\n    default_backend api_0001`
    : `backend ${name}\n    balance roundrobin\n    server s1 127.0.0.1:${8000 + (i % 1000)} check`;
}

function nonHaproxyCfgContent(i: number): string {
  return [
    `# synthetic non-HAProxy cfg ${i}`,
    "[service]",
    `name=not-haproxy-${i}`,
    "enabled=true",
  ].join("\n");
}

function createWorkspaceDocs(
  count: number,
  contentForIndex: (index: number) => string,
  folder = "file:///workspace/haproxy",
) {
  return Array.from({ length: count }, (_, i) =>
    createDocument(contentForIndex(i), `${folder}/cfg_${String(i).padStart(4, "0")}.cfg`),
  );
}

const splitDocs = createWorkspaceDocs(200, haproxySplitContent);
const manyCfgDocs = createWorkspaceDocs(manyCfgFileCount, haproxySplitContent);
const mixedCfgDocs = createWorkspaceDocs(mixedCfgFileCount, (i) =>
  i % 2 === 0 ? haproxySplitContent(i) : nonHaproxyCfgContent(i),
);
const mixedIndexProbe = buildWorkspaceSymbolIndexFromOpenDocuments(
  mixedCfgDocs,
  bundle.schema,
  4000,
);

if (mixedIndexProbe.documents.size !== haproxyFileCountInMixedWorkspace) {
  throw new Error(
    `Expected ${haproxyFileCountInMixedWorkspace} HAProxy cfg files in mixed workspace benchmark, got ${mixedIndexProbe.documents.size}`,
  );
}

resetVscodeMock();
setMockWorkspaceFolders([discoveryWorkspaceFolder]);
setMockWorkspaceFile(diskLargeCfgPath, largeCfgContent);
setMockWorkspaceFileStat(diskOversizedCfgPath, Date.now(), largeCfgByteLength + 1);
for (let i = 0; i < discoveryCfgFileCount; i += 1) {
  setMockWorkspaceFile(
    `${discoveryWorkspacePath}/cfg_${String(i).padStart(4, "0")}.cfg`,
    i % 2 === 0 ? haproxySplitContent(i) : nonHaproxyCfgContent(i),
  );
}

describe("workspaceSymbolIndex", () => {
  test("discover workspace cfg files: 1000 matched cfg URIs", async ({ bench }) => {
    await bench("discover workspace cfg files: 1000 matched cfg URIs", async () => {
      const discoveredUris = await getDiscoveredUris(
        discoverySettings,
        discoveryWorkspaceFolder,
        discoveryWorkspaceFolderKey,
        true,
      );
      if (discoveredUris.length !== discoveryCfgFileCount) {
        throw new Error(
          `Expected ${discoveryCfgFileCount} discovered cfg URIs, got ${discoveredUris.length}`,
        );
      }
    }).run({ time: 500, warmupIterations: 2 });
  });

  test("build workspace graph: 200 split cfg files (warm documents)", async ({ bench }) => {
    await bench("build workspace graph: 200 split cfg files (warm documents)", () => {
      buildWorkspaceSymbolIndexFromOpenDocuments(splitDocs, bundle.schema, 4000);
    }).run();
  });

  test("build workspace graph: 1000 split cfg files (warm documents)", async ({ bench }) => {
    await bench("build workspace graph: 1000 split cfg files (warm documents)", () => {
      buildWorkspaceSymbolIndexFromOpenDocuments(manyCfgDocs, bundle.schema, 4000);
    }).run({ time: 500, warmupIterations: 2 });
  });

  test("build workspace graph: 1000 split cfg files (fresh documents)", async ({ bench }) => {
    await bench("build workspace graph: 1000 split cfg files (fresh documents)", () => {
      buildWorkspaceSymbolIndexFromOpenDocuments(
        createWorkspaceDocs(manyCfgFileCount, haproxySplitContent),
        bundle.schema,
        4000,
      );
    }).run({ time: 500, warmupIterations: 2 });
  });

  test("build workspace graph: 1000 mixed cfg files (500 indexed, 500 skipped, warm documents)", async ({
    bench,
  }) => {
    await bench(
      "build workspace graph: 1000 mixed cfg files (500 indexed, 500 skipped, warm documents)",
      () => {
        buildWorkspaceSymbolIndexFromOpenDocuments(mixedCfgDocs, bundle.schema, 4000);
      },
    ).run({ time: 500, warmupIterations: 2 });
  });

  test("load disk entry: read+index large cfg under byte cap", async ({ bench }) => {
    await bench("load disk entry: read+index large cfg under byte cap", async () => {
      await loadDiskEntry(
        Uri.file(diskLargeCfgPath) as never,
        bundle.schema,
        BENCH_LARGE_MAX_LINES,
        undefined,
        diskReadLimits,
      );
    }).run({ time: 500, warmupIterations: 1 });
  });

  test("load disk entry: skip oversized cfg by stat before read", async ({ bench }) => {
    await bench("load disk entry: skip oversized cfg by stat before read", async () => {
      await loadDiskEntry(
        Uri.file(diskOversizedCfgPath) as never,
        bundle.schema,
        BENCH_LARGE_MAX_LINES,
        undefined,
        diskSkipLimits,
      );
    }).run({ time: 500, warmupIterations: 2 });
  });

  test("fingerprint 200 workspace documents", async ({ bench }) => {
    await bench("fingerprint 200 workspace documents", () => {
      for (const doc of splitDocs) {
        fingerprintText(doc.getText());
      }
    }).run();
  });
});

describe("workspace index scheduler (1000 files)", () => {
  const scenarios = [
    ["single symbol edit", 1],
    ["burst of symbol edits", 10],
    ["external file change", 0],
  ] as const;
  for (const [scenario, editCount] of scenarios) {
    // eslint-disable-next-line vitest/valid-title
    test(scenario, async ({ bench }) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      clearWorkspaceSymbolIndex();
      const uriFor = (i: number) =>
        `${discoveryWorkspacePath}/cfg_${String(i).padStart(4, "0")}.cfg`;
      for (let i = 0; i < discoveryCfgFileCount; i += 1) {
        setMockWorkspaceFile(uriFor(i), haproxySplitContent(i));
      }
      const flush = () => vi.runAllTimersAsync();
      const schedule = (options?: Parameters<typeof scheduleWorkspaceSymbolIndexRebuild>[3]) =>
        scheduleWorkspaceSymbolIndexRebuild(bundle.schema, discoverySettings, 4000, options);
      const aggregations = vi.spyOn(workspaceDocuments, "aggregateDocuments");
      const stats = vi.spyOn(workspace.fs, "stat");
      const reads = vi.spyOn(workspace.fs, "readFile");
      try {
        schedule();
        await flush();
        expect(getWorkspaceSymbolIndex()?.documents.size).toBe(discoveryCfgFileCount);
        let revision = 0;
        await bench(scenario, async () => {
          aggregations.mockClear();
          stats.mockClear();
          reads.mockClear();
          revision += 1;
          if (editCount > 0) {
            for (let i = 0; i < editCount; i += 1) {
              const document = {
                ...createDocument(`backend edit_${i}_${revision}`, uriFor(i)),
                version: revision,
              };
              schedule({ scope: "incremental", document });
            }
          } else {
            const path = uriFor(0);
            const content = `backend disk_${revision}`;
            setMockWorkspaceFile(path, content);
            setMockWorkspaceFileStat(path, revision, content.length);
            const uri = Uri.file(path) as unknown as WorkspaceFolder["uri"];
            schedule({ scope: "incremental", uri });
          }
          await flush();
        }).run({ time: 500, warmupIterations: 2 });
        expect(aggregations).toHaveBeenCalledTimes(1);
        expect(stats).toHaveBeenCalledTimes(editCount === 0 ? 1 : 0);
        expect(reads).toHaveBeenCalledTimes(editCount === 0 ? 1 : 0);
        console.info(
          `${scenario}: ${aggregations.mock.calls.length} aggregation, ${stats.mock.calls.length} stat, ${reads.mock.calls.length} read`,
        );
      } finally {
        aggregations.mockRestore();
        stats.mockRestore();
        reads.mockRestore();
        clearWorkspaceSymbolIndex();
        vi.useRealTimers();
      }
    });
  }
});
