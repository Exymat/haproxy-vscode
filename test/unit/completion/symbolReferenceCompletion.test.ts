import { provideCompletionItems } from "../../../src/completion";
import {
  clearWorkspaceSymbolIndex,
  listDefinitionNames,
  resolveExpectedSymbolReferenceAtCompletion,
  scheduleWorkspaceSymbolIndexRebuild,
} from "../../../src/symbolIndex";
import { buildSymbolIndex } from "../../../src/symbolIndex/build";
import { parseDocument } from "../../helpers/parse";
import {
  mockTextDocuments,
  resetMockVscode,
  setMockWorkspaceFile,
  setMockWorkspaceFolders,
} from "../../helpers/vscode";
import { createDocument } from "../../helpers/document";
import { bundle, completionLabels } from "./helpers";
import { defaultWorkspaceSymbolSettings } from "../workspaceSymbolIndex/helpers";

function pos(line: number, character: number) {
  return { line, character } as never;
}

function completionAt(content: string, line: number, character: number) {
  const doc = createDocument(content);
  return provideCompletionItems(doc, pos(line, character), bundle.languageData, bundle.schema);
}

describe("expected symbol reference resolution", () => {
  it("detects backend references on use_backend", () => {
    const doc = createDocument("backend api\nfrontend web\n    use_backend ");
    const col = "    use_backend ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), bundle.schema)).toEqual({
      kind: "proxy-section",
      scopeKey: null,
    });
  });

  it("detects defaults profile references after from", () => {
    const doc = createDocument("defaults base\nfrontend web from ");
    const col = "frontend web from ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(1, col), bundle.schema)).toEqual({
      kind: "defaults-profile",
      scopeKey: null,
    });
  });

  it("detects ACL references in rule conditions", () => {
    const doc = createDocument(
      "frontend web\n    acl is_api path_beg /api\n    use_backend api if ",
    );
    const col = "    use_backend api if ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), bundle.schema)).toEqual({
      kind: "acl",
      scopeKey: "frontend:web",
    });
  });

  it("detects server references on use-server", () => {
    const doc = createDocument("backend api\n    server s1 127.0.0.1:80\n    use-server ");
    const col = "    use-server ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), bundle.schema)).toEqual({
      kind: "server",
      scopeKey: "backend:api",
    });
  });

  it("detects filter references in filter-sequence lists", () => {
    const doc = createDocument("frontend web\n    filter comp-req\n    filter-sequence request ");
    const col = "    filter-sequence request ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(2, col), bundle.schema)).toEqual({
      kind: "filter",
      scopeKey: "frontend:web",
    });
  });

  it("detects userlist references inside http_auth sample fetches", () => {
    const doc = createDocument("frontend web\n    acl AUTH http_auth(");
    const col = "    acl AUTH http_auth(".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(1, col), bundle.schema)).toEqual({
      kind: "userlist",
      scopeKey: null,
    });
  });

  it("does not treat section definition names as references", () => {
    const doc = createDocument("backend ");
    expect(
      resolveExpectedSymbolReferenceAtCompletion(doc, pos(0, "backend ".length), bundle.schema),
    ).toBeNull();
  });

  it("does not treat ACL criterion positions as ACL name references", () => {
    const doc = createDocument("frontend web\n    acl test ");
    const col = "    acl test ".length;
    expect(resolveExpectedSymbolReferenceAtCompletion(doc, pos(1, col), bundle.schema)).toBeNull();
  });
});

describe("listDefinitionNames", () => {
  it("lists scoped and global definitions separately", () => {
    const content = [
      "frontend web",
      "    acl one path /one",
      "backend api",
      "    acl two path /two",
      "backend other",
    ].join("\n");
    const index = buildSymbolIndex(parseDocument(createDocument(content)), bundle.schema);
    expect(listDefinitionNames(index, "proxy-section", null)).toEqual(["api", "other", "web"]);
    expect(listDefinitionNames(index, "acl", "frontend:web")).toEqual(["one"]);
    expect(listDefinitionNames(index, "acl", "backend:api")).toEqual(["two"]);
  });
});

describe("symbol reference completion", () => {
  it("suggests backends for use_backend", () => {
    const labels = completionLabels(
      "backend api\nfrontend web\n    use_backend ",
      2,
      "    use_backend ".length,
    );
    expect(labels).toContain("api");
  });

  it("filters backend suggestions by prefix", () => {
    const labels = completionLabels(
      "backend api\nbackend app\nfrontend web\n    use_backend a",
      3,
      "    use_backend a".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["api", "app"]));
    expect(labels).not.toContain("web");
  });

  it("suggests named defaults profiles after from", () => {
    const labels = completionLabels(
      "defaults base\nfrontend web from ",
      1,
      "frontend web from ".length,
    );
    expect(labels).toContain("base");
  });

  it("suggests scoped ACLs in rule conditions", () => {
    const labels = completionLabels(
      "frontend web\n    acl is_api path_beg /api\n    use_backend api if ",
      2,
      "    use_backend api if ".length,
    );
    expect(labels).toContain("is_api");
    expect(labels).toContain("TRUE");
  });

  it("does not suggest ACLs from other sections", () => {
    const labels = completionLabels(
      "frontend web\n    acl local path_beg /local\nbackend api\n    acl remote path_beg /remote\nfrontend web\n    use_backend api if ",
      5,
      "    use_backend api if ".length,
    );
    expect(labels).toContain("local");
    expect(labels).not.toContain("remote");
  });

  it("suggests servers for use-server", () => {
    const labels = completionLabels(
      "backend api\n    server s1 127.0.0.1:80\n    server s2 127.0.0.1:81\n    use-server ",
      3,
      "    use-server ".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["s1", "s2"]));
  });

  it("suggests filter instance names in filter-sequence", () => {
    const labels = completionLabels(
      "frontend web\n    filter comp-req\n    filter comp-res\n    filter-sequence request ",
      3,
      "    filter-sequence request ".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["comp-req", "comp-res"]));
  });

  it("still prefers ACL criteria when defining an ACL", () => {
    const labels = completionLabels("frontend web\n    acl test ", 1, "    acl test ".length);
    expect(labels).toContain("path");
    expect(labels).not.toContain("test");
  });

  it("still suggests filter-sequence phase enums before filter names", () => {
    const labels = completionLabels(
      "frontend web\n    filter comp-req\n    filter-sequence ",
      2,
      "    filter-sequence ".length,
    );
    expect(labels).toEqual(expect.arrayContaining(["request", "response"]));
    expect(labels).not.toContain("comp-req");
  });

  it("suggests cache, resolvers, peers, and userlist references", () => {
    const content = [
      "cache my_cache",
      "resolvers dns-main",
      "peers cluster",
      "userlist stats-auth",
      "frontend web from base",
      "    http-request cache-use ",
      "backend api",
      "    server s1 host:80 resolvers ",
      "    stick-table type ip size 1 peers ",
      "    acl AUTH http_auth(",
      "defaults base",
    ].join("\n");

    expect(
      completionAt(content, 5, "    http-request cache-use ".length)
        .map((item) => item.label)
        .sort(),
    ).toContain("my_cache");

    expect(
      completionAt(content, 7, "    server s1 host:80 resolvers ".length)
        .map((item) => item.label)
        .sort(),
    ).toContain("dns-main");

    expect(
      completionAt(content, 8, "    stick-table type ip size 1 peers ".length)
        .map((item) => item.label)
        .sort(),
    ).toContain("cluster");

    expect(
      completionAt(content, 9, "    acl AUTH http_auth(".length)
        .map((item) => item.label)
        .sort(),
    ).toContain("stats-auth");
  });

  it("includes workspace backend definitions in completion", async () => {
    vi.useFakeTimers();
    resetMockVscode();
    clearWorkspaceSymbolIndex();

    setMockWorkspaceFolders([{ uri: { fsPath: "C:\\Repo", toString: () => "file:///repo" } }]);
    const frontendContent = "frontend web\n    use_backend ";
    setMockWorkspaceFile("file:///repo/frontends/web.cfg", frontendContent);
    setMockWorkspaceFile(
      "file:///repo/backends/api.cfg",
      "backend api\n    server s1 127.0.0.1:80",
    );
    const frontend = createDocument(frontendContent, "file:///repo/frontends/web.cfg");
    mockTextDocuments.push(frontend as never);

    scheduleWorkspaceSymbolIndexRebuild(bundle.schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const labels = provideCompletionItems(
      frontend,
      pos(1, "    use_backend ".length),
      bundle.languageData,
      bundle.schema,
    ).map((item) => item.label);

    expect(labels).toContain("api");

    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("returns an empty list when the prefix filters out every candidate", () => {
    const line = "backend api\nfrontend web\n    use_backend z";
    const zCol = line.lastIndexOf("z");
    const items = completionAt(line, 2, zCol);
    expect(items).toEqual([]);
  });

  it("falls back to predefined ACLs when the symbol index is unavailable", () => {
    const labels = provideCompletionItems(
      createDocument("frontend web\n    use_backend api if "),
      pos(1, "    use_backend api if ".length),
      bundle.languageData,
      bundle.schema,
      0,
    ).map((item) => item.label);
    expect(labels).toContain("TRUE");
    expect(labels).not.toContain("api");
  });

  it("returns no candidates for unavailable indexes on non-ACL references", () => {
    const items = provideCompletionItems(
      createDocument("backend api\nfrontend web\n    use_backend "),
      pos(2, "    use_backend ".length),
      bundle.languageData,
      bundle.schema,
      0,
    );
    expect(items).toEqual([]);
  });

  it("does not include workspace scoped symbols from other sections", async () => {
    vi.useFakeTimers();
    resetMockVscode();
    clearWorkspaceSymbolIndex();

    setMockWorkspaceFolders([{ uri: { fsPath: "C:\\Repo", toString: () => "file:///repo" } }]);
    const frontendA = "frontend a\n    filter fa\n    filter-sequence request ";
    setMockWorkspaceFile("file:///repo/frontends/a.cfg", frontendA);
    setMockWorkspaceFile(
      "file:///repo/frontends/b.cfg",
      "frontend b\n    filter fb\n    filter-sequence request comp",
    );
    const doc = createDocument(frontendA, "file:///repo/frontends/a.cfg");
    mockTextDocuments.push(doc as never);

    scheduleWorkspaceSymbolIndexRebuild(bundle.schema, defaultWorkspaceSymbolSettings(), 4000);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    const labels = provideCompletionItems(
      doc,
      pos(2, "    filter-sequence request ".length),
      bundle.languageData,
      bundle.schema,
    ).map((item) => item.label);

    expect(labels).toContain("fa");
    expect(labels).not.toContain("fb");

    clearWorkspaceSymbolIndex();
    vi.useRealTimers();
  });

  it("uses predefined ACL names when the schema omits acl_predefined tokens", () => {
    const customSchema = structuredClone(bundle.schema);
    delete customSchema.tokens.acl_predefined;
    const labels = provideCompletionItems(
      createDocument("frontend web\n    use_backend api if "),
      pos(1, "    use_backend api if ".length),
      bundle.languageData,
      customSchema,
      0,
    ).map((item) => item.label);
    expect(labels).toEqual([]);
  });
});
