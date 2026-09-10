import { beforeAll, describe, test } from "vitest";

import { initTextMate, tokenizeDocument } from "../helpers/highlight";
import { fixtureLineCount, fixturesForScenario, readFixture } from "./helpers";

describe("tokenization", () => {
  beforeAll(async () => {
    await initTextMate();
  });

  for (const fixture of fixturesForScenario("tokenize")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    test(`tokenize ${fixture.name} (${lineCount} lines)`, async ({ bench }) => {
      await bench(`tokenize ${fixture.name} (${lineCount} lines)`, async () => {
        await tokenizeDocument(content);
      }).run({ warmupIterations: 2 });
    });
  }
});
