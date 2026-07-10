import { describe, expect, it } from "vitest";

import { tryOptionCompletion } from "../../../src/completion/handlers/option";
import { CompletionContext } from "../../../src/completion/types";
import { HaproxyLanguageData } from "../../../src/languageData";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

function optionCompletionContext(
  name: string,
  setup: (data: HaproxyLanguageData) => void,
  partial = name,
): CompletionContext {
  const data = structuredClone(bundle.languageData);
  data.groups.options = [
    {
      name,
      description: "",
      signature: `option ${name}`,
      rulesets: [],
    },
  ];
  setup(data);
  const text = `    option ${partial}`;
  const tokenStart = 11;
  return {
    document: createDocument(`defaults\n${text}`),
    position: { line: 1, character: text.length } as never,
    data,
    schema: bundle.schema,
    ctx: {
      kind: "option",
      tokenIndex: 1,
      line: {
        line: 1,
        text,
        indent: 4,
        section: "defaults",
        tokens: [
          { text: "option", start: 4, end: 10 },
          { text: partial, start: tokenStart, end: tokenStart + partial.length },
        ],
      },
    } as never,
    partial,
  };
}

function docValue(item: { documentation?: unknown }): string | undefined {
  const doc = item.documentation as { value?: string } | undefined;
  return doc?.value;
}

function assertItems(
  items: ReturnType<typeof tryOptionCompletion>,
): NonNullable<ReturnType<typeof tryOptionCompletion>> {
  expect(items).not.toBeNull();
  if (items === null) {
    throw new Error("expected completion items");
  }
  return items;
}

describe("tryOptionCompletion", () => {
  it("returns null for non-option contexts", () => {
    const cc = optionCompletionContext("bareopt", () => {});
    cc.ctx = { ...cc.ctx, kind: "directive" };
    expect(tryOptionCompletion(cc)).toBeNull();
  });

  it("omits documentation when no keyword or group metadata exists", () => {
    const cc = optionCompletionContext("bareopt", (data) => {
      delete data.keywords["option bareopt"];
      delete data.keywords["no option bareopt"];
    });
    const items = assertItems(tryOptionCompletion(cc));
    expect(items).toHaveLength(1);
    expect(items[0].detail).toBe("option");
    expect(items[0].documentation).toBeUndefined();
  });

  it("builds documentation from keyword examples without description", () => {
    const cc = optionCompletionContext("exonly", (data) => {
      data.groups.options = [
        {
          name: "exonly",
          signature: "option exonly",
          rulesets: [],
        } as never,
      ];
      data.keywords["option exonly"] = {
        name: "option exonly",
        signatures: ["option exonly"],
        sections: ["defaults"],
        description: "",
        docsUrl: "",
        arguments: [],
        examples: [{ title: "Example", code: "option exonly" }],
      };
    });
    const items = assertItems(tryOptionCompletion(cc));
    expect(items[0].documentation).toBeDefined();
    expect(docValue(items[0])).toContain("Example");
  });

  it("builds documentation from group examples when keyword is missing", () => {
    const cc = optionCompletionContext("groupex", (data) => {
      delete data.keywords["option groupex"];
      delete data.keywords["no option groupex"];
      data.groups.options = [
        {
          name: "groupex",
          signature: "option groupex",
          rulesets: [],
          examples: [{ title: "Group example", code: "option groupex" }],
        } as never,
      ];
    });
    const items = assertItems(tryOptionCompletion(cc));
    expect(items[0].documentation).toBeDefined();
    expect(docValue(items[0])).toContain("Group example");
  });

  it("uses group description when resolved keyword is missing", () => {
    const cc = optionCompletionContext("groupdesc", (data) => {
      delete data.keywords["option groupdesc"];
      delete data.keywords["no option groupdesc"];
      data.groups.options = [
        {
          name: "groupdesc",
          description: "Group description fallback.",
          signature: "option groupdesc",
          rulesets: [],
        },
      ];
    });
    const items = assertItems(tryOptionCompletion(cc));
    expect(items[0].documentation).toBeDefined();
    expect(docValue(items[0])).toContain("Group description fallback.");
  });

  it("uses group description when keyword description is undefined", () => {
    const cc = optionCompletionContext("undefdesc", (data) => {
      data.groups.options = [
        {
          name: "undefdesc",
          description: "Group description for undefined keyword.",
          signature: "option undefdesc",
          rulesets: [],
        },
      ];
      data.keywords["option undefdesc"] = {
        name: "option undefdesc",
        signatures: ["option undefdesc"],
        sections: ["defaults"],
        description: "",
        docsUrl: "",
        arguments: [],
      };
    });
    const items = assertItems(tryOptionCompletion(cc));
    expect(items[0].documentation).toBeDefined();
    expect(docValue(items[0])).toContain("Group description for undefined keyword.");
  });
});
