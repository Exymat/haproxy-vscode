import { describe, test } from "vitest";

import { loadSchemaBundle } from "../helpers/schema";
import { createDocument as createDocumentImpl } from "../helpers/document";
import { getParsedDocument as getParsedDocumentImpl } from "../../src/parser/parseCache";
import {
  createDiagnosticsEditRunner as createDiagnosticsEditRunnerImpl,
  runDiagnosticsAfterEditBaseline as runDiagnosticsAfterEditBaselineImpl,
  runDiagnosticsCold as runDiagnosticsColdImpl,
  runDiagnosticsWarm as runDiagnosticsWarmImpl,
} from "./diagnosticsHelpers";
import {
  BENCH_LARGE_MAX_LINES,
  findLineContaining,
  fixtureLineCount,
  fixturesForScenario,
  readFixture,
} from "./helpers";

const createDocument = createDocumentImpl;
const getParsedDocument = getParsedDocumentImpl;
const createDiagnosticsEditRunner = createDiagnosticsEditRunnerImpl;
const runDiagnosticsAfterEditBaseline = runDiagnosticsAfterEditBaselineImpl;
const runDiagnosticsCold = runDiagnosticsColdImpl;
const runDiagnosticsWarm = runDiagnosticsWarmImpl;

const bundle = loadSchemaBundle("3.4");

const logFormatDiagnosticsContent = [
  "defaults",
  '    log-format "%{+Q}o %ci"',
  '    error-log-format "%zz"',
  "frontend web",
  "    bind :80",
].join("\n");

const unusedSymbolOptions = {
  unusedSymbols: true,
  maxSymbolLines: BENCH_LARGE_MAX_LINES,
};

describe("diagnostics", () => {
  const warmDocs = new Map<string, ReturnType<typeof createDocument>>();
  const warmUnusedDocs = new Map<string, ReturnType<typeof createDocument>>();

  function warmDoc(
    cache: Map<string, ReturnType<typeof createDocument>>,
    key: string,
    content: string,
  ) {
    let document = cache.get(key);
    if (!document) {
      document = createDocument(content);
      getParsedDocument(document);
      cache.set(key, document);
    }
    return document;
  }

  for (const fixture of fixturesForScenario("diagnostics")) {
    const content = readFixture(fixture.file, fixture.from);
    const lineCount = fixtureLineCount(fixture);

    test(`diagnostics cold: ${fixture.name} (${lineCount} lines)`, async ({ bench }) => {
      await bench(`diagnostics cold: ${fixture.name} (${lineCount} lines)`, () => {
        runDiagnosticsCold(content, bundle);
      }).run();
    });

    test(`diagnostics warm: ${fixture.name} (${lineCount} lines)`, async ({ bench }) => {
      await bench(`diagnostics warm: ${fixture.name} (${lineCount} lines)`, () => {
        runDiagnosticsWarm(warmDoc(warmDocs, fixture.name, content), bundle);
      }).run({ warmupIterations: 2 });
    });

    if (fixture.name === "large-valid.cfg") {
      const editLine = findLineContaining(content, "maxconn 200000");
      const runner = createDiagnosticsEditRunner(content, bundle, editLine);
      let nextLine = "    maxconn 8192";

      test(`diagnostics edit baseline: ${fixture.name} (global maxconn change)`, async ({
        bench,
      }) => {
        await bench(`diagnostics edit baseline: ${fixture.name} (global maxconn change)`, () => {
          runDiagnosticsAfterEditBaseline(content, bundle, editLine, "    maxconn 8192");
        }).run();
      });
      test(`diagnostics edit: ${fixture.name} (global maxconn change)`, async ({ bench }) => {
        await bench(`diagnostics edit: ${fixture.name} (global maxconn change)`, () => {
          runner.run(nextLine);
          nextLine = nextLine === "    maxconn 8192" ? runner.originalLineText : "    maxconn 8192";
        }).run();
      });
    } else if (fixture.name === "large-mixed.cfg") {
      const editLine = findLineContaining(content, "timeout server banana");
      const runner = createDiagnosticsEditRunner(content, bundle, editLine);
      let nextLine = "    timeout server 30s";

      test(`diagnostics edit baseline: ${fixture.name} (repair invalid timeout)`, async ({
        bench,
      }) => {
        await bench(`diagnostics edit baseline: ${fixture.name} (repair invalid timeout)`, () => {
          runDiagnosticsAfterEditBaseline(content, bundle, editLine, "    timeout server 30s");
        }).run();
      });
      test(`diagnostics edit: ${fixture.name} (repair invalid timeout)`, async ({ bench }) => {
        await bench(`diagnostics edit: ${fixture.name} (repair invalid timeout)`, () => {
          runner.run(nextLine);
          nextLine =
            nextLine === "    timeout server 30s"
              ? runner.originalLineText
              : "    timeout server 30s";
        }).run();
      });
    } else {
      const editLine = content.split(/\r?\n/).findIndex((line) => line.trim().startsWith("mode "));
      const runner = createDiagnosticsEditRunner(content, bundle, editLine >= 0 ? editLine : 1);
      let nextLine = "    mode tcp";

      test(`diagnostics edit baseline: ${fixture.name} (mode line change)`, async ({ bench }) => {
        await bench(`diagnostics edit baseline: ${fixture.name} (mode line change)`, () => {
          runDiagnosticsAfterEditBaseline(
            content,
            bundle,
            editLine >= 0 ? editLine : 1,
            "    mode tcp",
          );
        }).run();
      });
      test(`diagnostics edit: ${fixture.name} (mode line change)`, async ({ bench }) => {
        await bench(`diagnostics edit: ${fixture.name} (mode line change)`, () => {
          runner.run(nextLine);
          nextLine = nextLine === "    mode tcp" ? runner.originalLineText : "    mode tcp";
        }).run();
      });
    }

    if (fixture.workload === "valid-large" || fixture.workload === "mixed-large") {
      test(`diagnostics cold: ${fixture.name} unusedSymbols (${lineCount} lines)`, async ({
        bench,
      }) => {
        await bench(`diagnostics cold: ${fixture.name} unusedSymbols (${lineCount} lines)`, () => {
          runDiagnosticsCold(content, bundle, unusedSymbolOptions);
        }).run();
      });

      test(`diagnostics warm: ${fixture.name} unusedSymbols (${lineCount} lines)`, async ({
        bench,
      }) => {
        await bench(`diagnostics warm: ${fixture.name} unusedSymbols (${lineCount} lines)`, () => {
          runDiagnosticsWarm(
            warmDoc(warmUnusedDocs, fixture.name, content),
            bundle,
            unusedSymbolOptions,
          );
        }).run({ warmupIterations: 2 });
      });

      if (fixture.name === "large-valid.cfg") {
        const editLine = findLineContaining(content, "maxconn 200000");
        const runner = createDiagnosticsEditRunner(content, bundle, editLine, unusedSymbolOptions);
        let nextLine = "    maxconn 8192";

        test(`diagnostics edit baseline: ${fixture.name} unusedSymbols (global maxconn change)`, async ({
          bench,
        }) => {
          await bench(
            `diagnostics edit baseline: ${fixture.name} unusedSymbols (global maxconn change)`,
            () => {
              runDiagnosticsAfterEditBaseline(
                content,
                bundle,
                editLine,
                "    maxconn 8192",
                unusedSymbolOptions,
              );
            },
          ).run();
        });
        test(`diagnostics edit: ${fixture.name} unusedSymbols (global maxconn change)`, async ({
          bench,
        }) => {
          await bench(
            `diagnostics edit: ${fixture.name} unusedSymbols (global maxconn change)`,
            () => {
              runner.run(nextLine);
              nextLine =
                nextLine === "    maxconn 8192" ? runner.originalLineText : "    maxconn 8192";
            },
          ).run();
        });
      } else if (fixture.name === "large-mixed.cfg") {
        const editLine = findLineContaining(content, "timeout server banana");
        const runner = createDiagnosticsEditRunner(content, bundle, editLine, unusedSymbolOptions);
        let nextLine = "    timeout server 30s";

        test(`diagnostics edit baseline: ${fixture.name} unusedSymbols (repair invalid timeout)`, async ({
          bench,
        }) => {
          await bench(
            `diagnostics edit baseline: ${fixture.name} unusedSymbols (repair invalid timeout)`,
            () => {
              runDiagnosticsAfterEditBaseline(
                content,
                bundle,
                editLine,
                "    timeout server 30s",
                unusedSymbolOptions,
              );
            },
          ).run();
        });
        test(`diagnostics edit: ${fixture.name} unusedSymbols (repair invalid timeout)`, async ({
          bench,
        }) => {
          await bench(
            `diagnostics edit: ${fixture.name} unusedSymbols (repair invalid timeout)`,
            () => {
              runner.run(nextLine);
              nextLine =
                nextLine === "    timeout server 30s"
                  ? runner.originalLineText
                  : "    timeout server 30s";
            },
          ).run();
        });
      }
    }
  }

  test("diagnostics cold: log-format validation", async ({ bench }) => {
    await bench("diagnostics cold: log-format validation", () => {
      runDiagnosticsCold(logFormatDiagnosticsContent, bundle);
    }).run();
  });

  test("diagnostics warm: log-format validation", async ({ bench }) => {
    await bench("diagnostics warm: log-format validation", () => {
      runDiagnosticsWarm(
        warmDoc(warmDocs, "log-format validation", logFormatDiagnosticsContent),
        bundle,
      );
    }).run({ warmupIterations: 2 });
  });
});
