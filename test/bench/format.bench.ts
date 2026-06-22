import { bench, describe } from "vitest";

import { DEFAULT_FORMAT_OPTIONS, formatConfig } from "../../src/formatter";
import { fixtureLineCount, fixturesForScenario, readFixture } from "./helpers";

describe("format", () => {
  for (const fixture of fixturesForScenario("format")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    bench(`format: ${fixture.name} (${lineCount} lines)`, () => {
      formatConfig(content, DEFAULT_FORMAT_OPTIONS);
    });
  }

  const messyContent = readFixture("messy-format.cfg", "integration");
  const messyLines = messyContent.split(/\r?\n/).length;

  bench(`format: messy-format.cfg (${messyLines} lines)`, () => {
    formatConfig(messyContent, DEFAULT_FORMAT_OPTIONS);
  });
});
