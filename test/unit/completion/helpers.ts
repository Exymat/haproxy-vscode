import { provideCompletionItems } from "../../../src/completion";
import * as languageDataIndexes from "../../../src/language/languageDataIndexes";
import type { LanguageGroupItem } from "../../../src/language/languageData";
import { createDocument } from "../../helpers/document";
import { cursorAtLineEnd } from "../../helpers/cursor";
import { loadSchemaBundle } from "../../helpers/schema";

export const bundle = loadSchemaBundle("3.4");

export function mockOptionsGroupItems(items: LanguageGroupItem[]): void {
  const byName = new Map(items.map((item) => [item.name, item]));
  const origIndexedGroupItems = languageDataIndexes.indexedGroupItems;
  const origIndexedGroupItemsByName = languageDataIndexes.indexedGroupItemsByName;
  vi.spyOn(languageDataIndexes, "indexedGroupItems").mockImplementation((data, group) => {
    if (group === "options") {
      return items;
    }
    return origIndexedGroupItems(data, group);
  });
  vi.spyOn(languageDataIndexes, "indexedGroupItemsByName").mockImplementation((data, group) => {
    if (group === "options") {
      return byName;
    }
    return origIndexedGroupItemsByName(data, group);
  });
}

export function completionLabels(content: string, lineNo: number, character?: number) {
  const doc = createDocument(content);
  const position =
    character === undefined ? cursorAtLineEnd(content, lineNo) : { line: lineNo, character };
  const items = provideCompletionItems(doc, position as never, bundle.languageData, bundle.schema);
  return items.map((item) => item.label).sort();
}
