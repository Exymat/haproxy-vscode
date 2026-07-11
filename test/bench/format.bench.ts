import { bench, describe } from "vitest";

import { formatConfig } from "../../src/formatting";
import { formatOptionsWithSchema } from "../helpers/formatOptions";
import { fixtureLineCount, fixturesForScenario, readFixture } from "./helpers";

const formatOptions = formatOptionsWithSchema("3.2");

describe("format", () => {
  for (const fixture of fixturesForScenario("format")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    bench(`format: ${fixture.name} (${lineCount} lines)`, () => {
      formatConfig(content, formatOptions);
    });
  }

  const messyContent = readFixture("messy-format.cfg", "integration");
  const messyLines = messyContent.split(/\r?\n/).length;

  bench(`format: messy-format.cfg (${messyLines} lines)`, () => {
    formatConfig(messyContent, formatOptions);
  });
});
