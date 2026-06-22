import { bench, describe } from "vitest";

import { loadSchemaBundle } from "../helpers/schema";
import { createDocument } from "../helpers/document";
import { getParsedDocument } from "../../src/parseCache";
import {
  findLineContaining,
  fixtureLineCount,
  fixturesForScenario,
  readFixture,
  runDiagnosticsAfterEdit,
  runDiagnosticsCold,
  runDiagnosticsWarm,
} from "./helpers";

const bundle = loadSchemaBundle("3.2");

describe("diagnostics", () => {
  const warmDocs = new Map<string, ReturnType<typeof createDocument>>();
  type DiagnosticsFixture = ReturnType<typeof fixturesForScenario>[number];

  function warmDoc(fixture: DiagnosticsFixture, content: string) {
    let document = warmDocs.get(fixture.name);
    if (!document) {
      document = createDocument(content);
      getParsedDocument(document);
      warmDocs.set(fixture.name, document);
    }
    return document;
  }

  for (const fixture of fixturesForScenario("diagnostics")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    bench(`diagnostics cold: ${fixture.name} (${lineCount} lines)`, () => {
      runDiagnosticsCold(content, bundle);
    });

    bench(
      `diagnostics warm: ${fixture.name} (${lineCount} lines)`,
      () => {
        runDiagnosticsWarm(warmDoc(fixture, content), bundle);
      },
      { warmupIterations: 2 },
    );

    if (fixture.name === "large-valid.cfg") {
      const editLine = findLineContaining(content, "maxconn 200000");
      bench(`diagnostics edit: ${fixture.name} (global maxconn change)`, () => {
        runDiagnosticsAfterEdit(content, bundle, editLine, "    maxconn 8192");
      });
    } else if (fixture.name === "large-mixed.cfg") {
      const editLine = findLineContaining(content, "timeout server banana");
      bench(`diagnostics edit: ${fixture.name} (repair invalid timeout)`, () => {
        runDiagnosticsAfterEdit(content, bundle, editLine, "    timeout server 30s");
      });
    } else {
      const editLine = content.split(/\r?\n/).findIndex((line) => line.trim().startsWith("mode "));
      bench(`diagnostics edit: ${fixture.name} (mode line change)`, () => {
        runDiagnosticsAfterEdit(content, bundle, editLine >= 0 ? editLine : 1, "    mode tcp");
      });
    }
  }
});
