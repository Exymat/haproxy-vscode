import { bench, describe } from "vitest";

import { provideCompletionItems } from "../../src/completion";
import { loadSchemaBundle } from "../helpers/schema";
import { createDocument } from "../helpers/document";
import { findLineContaining, readFixture } from "./helpers";

const bundle = loadSchemaBundle("3.2");
const largeContent = readFixture("large-valid.cfg", "bench");
const largeBackendLine = findLineContaining(largeContent, "balance ");

interface CompletionCase {
  name: string;
  content: string;
  line: number;
  character: number;
}

const completionCases: CompletionCase[] = [
  {
    name: "defaults directives",
    content: "defaults\n    ",
    line: 1,
    character: 4,
  },
  {
    name: "http-request action",
    content: "frontend web\n    http-request ",
    line: 1,
    character: "    http-request ".length,
  },
  {
    name: "section header",
    content: "",
    line: 0,
    character: 0,
  },
  {
    name: "large-valid.cfg backend directive",
    content: largeContent,
    line: largeBackendLine,
    character: 4,
  },
];

describe("completion", () => {
  for (const testCase of completionCases) {
    bench(`completion: ${testCase.name}`, () => {
      const doc = createDocument(testCase.content);
      provideCompletionItems(
        doc,
        { line: testCase.line, character: testCase.character } as never,
        bundle.languageData,
        bundle.schema,
      );
    });
  }

  bench(
    "completion warm: defaults directives",
    () => {
      const doc = createDocument("defaults\n    ");
      for (let i = 0; i < 20; i += 1) {
        provideCompletionItems(
          doc,
          { line: 1, character: 4 } as never,
          bundle.languageData,
          bundle.schema,
        );
      }
    },
    { time: 500, warmupIterations: 3 },
  );
});
