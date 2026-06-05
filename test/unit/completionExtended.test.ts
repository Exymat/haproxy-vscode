import { provideCompletionItems } from "../../src/completion";
import * as documentContext from "../../src/documentContext";
import { createDocument } from "../helpers/document";
import { loadSchemaBundle } from "../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function completionLabels(content: string, lineNo: number, character: number) {
  const doc = createDocument(content);
  const items = provideCompletionItems(
    doc as never,
    { line: lineNo, character },
    bundle.languageData,
    bundle.schema,
  );
  return items.map((item) => item.label).sort();
}

describe("completion extended", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suggests section headers at file start", () => {
    const labels = completionLabels("", 0, 0);
    expect(labels).toEqual(expect.arrayContaining(["global", "defaults", "frontend", "backend"]));
  });

  it("suggests option names", () => {
    const content = "defaults\n    no option ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual(expect.arrayContaining(["httplog", "forwardfor"]));
  });

  it("suggests services after http-request use-service", () => {
    const origGroupItems = documentContext.groupItems;
    vi.spyOn(documentContext, "groupItems").mockImplementation((data, group) => {
      if (group === "services") {
        return [{ name: "ping", description: "ping service", signature: "ping", rulesets: [] }];
      }
      return origGroupItems(data, group);
    });
    const content = "frontend web\n    http-request use-service ";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels).toContain("ping");
  });

  it("suggests tcp-request actions", () => {
    const content = "frontend web\n    tcp-request connection ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toContain("acl");
  });

  it("suggests filter names", () => {
    const content = "backend api\n    filter ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("suggests sample fetches in expressions", () => {
    const content = "frontend web\n    http-request set-header X %[req.";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("suggests sample converters after colon in expression", () => {
    const content = "frontend web\n    http-request set-header X %[path(0):";
    const line = content.split("\n")[1];
    const labels = completionLabels(content, 1, line.length);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("suggests acl criteria", () => {
    const content = "frontend web\n    acl test ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual(expect.arrayContaining(["path", "hdr"]));
  });

  it("returns empty for directive-argument without matched directive", () => {
    const content = "defaults\n    notadirective ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual([]);
  });

  it("suggests section directive keywords", () => {
    const content = "frontend web\n    bi";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels).toEqual(expect.arrayContaining(["bind"]));
  });

  it("returns empty on section header lines", () => {
    const labels = completionLabels("global", 0, 1);
    expect(labels).toEqual([]);
  });

  it("suggests http-request actions", () => {
    const content = "frontend web\n    http-request set";
    const line = content.split("\n")[1];
    const col = line.indexOf("set");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual(expect.arrayContaining(["set-header", "add-header"]));
  });

  it("suggests http-response actions", () => {
    const content = "frontend web\n    http-response set";
    const line = content.split("\n")[1];
    const col = line.indexOf("set");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual(expect.arrayContaining(["set-header", "add-header"]));
  });

  it("suggests http-after-response actions", () => {
    const content = "frontend web\n    http-after-response set";
    const line = content.split("\n")[1];
    const col = line.indexOf("set");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual(expect.arrayContaining(["set-header", "add-header"]));
  });

  it("suggests tcp-response actions", () => {
    const content = "frontend web\n    tcp-response content ";
    const labels = completionLabels(content, 1, content.split("\n")[1].length);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toContain("acl");
  });

  it("suggests filter names at the filter token", () => {
    const content = "backend api\n    filter";
    const col = "    filter".indexOf("filter");
    const labels = completionLabels(content, 1, col);
    expect(labels.length).toBeGreaterThan(0);
  });

  it("returns no directive suggestions when token index is not zero", () => {
    const content = "frontend web\n    bind :80 extra";
    const col = content.split("\n")[1].indexOf("extra");
    const labels = completionLabels(content, 1, col);
    expect(labels).toEqual([]);
  });
});
