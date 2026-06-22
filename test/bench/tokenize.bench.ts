import { beforeAll, bench, describe } from "vitest";

import { initTextMate, tokenizeDocument } from "../helpers/highlight";
import { fixtureLineCount, fixturesForScenario, readFixture } from "./helpers";

describe("tokenization", () => {
  beforeAll(async () => {
    await initTextMate();
  });

  for (const fixture of fixturesForScenario("tokenize")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    bench(
      `tokenize ${fixture.name} (${lineCount} lines)`,
      async () => {
        await tokenizeDocument(content);
      },
      { warmupIterations: 2 },
    );
  }
});
