import { logFormatCompletionItems } from "../../../src/completion/helpers";
import * as documentContext from "../../../src/documentContext";
import { bundle } from "./helpers";

describe("logFormatCompletionItems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to alias completions without an active token", () => {
    const text = "plain text";
    const items = logFormatCompletionItems(bundle.languageData, bundle.schema, text, text.length);
    expect(items).toHaveLength(
      documentContext.groupItems(bundle.languageData, "logformat_aliases").length,
    );
  });

  it("handles missing flag catalogs and undocumented aliases", () => {
    const schema = structuredClone(bundle.schema);
    delete schema.tokens.logformat_flags;
    expect(logFormatCompletionItems(bundle.languageData, schema, "%{+", 3)).toEqual([]);

    schema.tokens.logformat_flags = ["UNKNOWNFLAGXYZ"];
    const flagItems = logFormatCompletionItems(bundle.languageData, schema, "%{+", 3);
    expect(flagItems).toHaveLength(1);
    expect(flagItems[0].documentation).toBeUndefined();

    vi.spyOn(documentContext, "groupItems").mockReturnValue([
      { name: "%nodesc", description: "", rulesets: [] },
    ] as never);
    const aliasItems = logFormatCompletionItems(bundle.languageData, bundle.schema, "%", 1);
    expect(aliasItems[0]?.label).toBe("nodesc");
    expect(aliasItems[0]?.documentation).toBeUndefined();
  });
});
