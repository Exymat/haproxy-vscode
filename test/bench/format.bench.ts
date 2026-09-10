import { describe, test } from "vitest";

import { formatConfig } from "../../src/formatting";
import { formatOptionsWithSchema } from "../helpers/formatOptions";
import { fixtureLineCount, fixturesForScenario, readFixture } from "./helpers";

const formatOptions = formatOptionsWithSchema("3.2");

describe("format", () => {
  for (const fixture of fixturesForScenario("format")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    test(`format: ${fixture.name} (${lineCount} lines)`, async ({ bench }) => {
      await bench(`format: ${fixture.name} (${lineCount} lines)`, () => {
        formatConfig(content, formatOptions);
      }).run();
    });
  }

  const messyContent = readFixture("messy-format.cfg", "integration");
  const messyLines = messyContent.split(/\r?\n/).length;

  test(`format: messy-format.cfg (${messyLines} lines)`, async ({ bench }) => {
    await bench(`format: messy-format.cfg (${messyLines} lines)`, () => {
      formatConfig(messyContent, formatOptions);
    }).run();
  });
});
