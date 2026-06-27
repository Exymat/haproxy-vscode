import { bench, describe } from "vitest";

import { loadSchemaBundle } from "../helpers/schema";
import { createDocument } from "../helpers/document";
import { getParsedDocument } from "../../src/parseCache";
import {
  createDiagnosticsEditRunner,
  runDiagnosticsAfterEditBaseline,
  runDiagnosticsCold,
  runDiagnosticsWarm,
} from "./diagnosticsHelpers";
import {
  BENCH_LARGE_MAX_LINES,
  findLineContaining,
  fixtureLineCount,
  fixturesForScenario,
  readFixture,
} from "./helpers";

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
  unusedSymbolSections: true,
  maxLines: BENCH_LARGE_MAX_LINES,
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

    bench(`diagnostics cold: ${fixture.name} (${lineCount} lines)`, () => {
      runDiagnosticsCold(content, bundle);
    });

    bench(
      `diagnostics warm: ${fixture.name} (${lineCount} lines)`,
      () => {
        runDiagnosticsWarm(warmDoc(warmDocs, fixture.name, content), bundle);
      },
      { warmupIterations: 2 },
    );

    if (fixture.name === "large-valid.cfg") {
      const editLine = findLineContaining(content, "maxconn 200000");
      const runner = createDiagnosticsEditRunner(content, bundle, editLine);
      let nextLine = "    maxconn 8192";
      bench(`diagnostics edit baseline: ${fixture.name} (global maxconn change)`, () => {
        runDiagnosticsAfterEditBaseline(content, bundle, editLine, "    maxconn 8192");
      });
      bench(`diagnostics edit: ${fixture.name} (global maxconn change)`, () => {
        runner.run(nextLine);
        nextLine = nextLine === "    maxconn 8192" ? runner.originalLineText : "    maxconn 8192";
      });
    } else if (fixture.name === "large-mixed.cfg") {
      const editLine = findLineContaining(content, "timeout server banana");
      const runner = createDiagnosticsEditRunner(content, bundle, editLine);
      let nextLine = "    timeout server 30s";
      bench(`diagnostics edit baseline: ${fixture.name} (repair invalid timeout)`, () => {
        runDiagnosticsAfterEditBaseline(content, bundle, editLine, "    timeout server 30s");
      });
      bench(`diagnostics edit: ${fixture.name} (repair invalid timeout)`, () => {
        runner.run(nextLine);
        nextLine =
          nextLine === "    timeout server 30s"
            ? runner.originalLineText
            : "    timeout server 30s";
      });
    } else {
      const editLine = content.split(/\r?\n/).findIndex((line) => line.trim().startsWith("mode "));
      const runner = createDiagnosticsEditRunner(content, bundle, editLine >= 0 ? editLine : 1);
      let nextLine = "    mode tcp";
      bench(`diagnostics edit baseline: ${fixture.name} (mode line change)`, () => {
        runDiagnosticsAfterEditBaseline(
          content,
          bundle,
          editLine >= 0 ? editLine : 1,
          "    mode tcp",
        );
      });
      bench(`diagnostics edit: ${fixture.name} (mode line change)`, () => {
        runner.run(nextLine);
        nextLine = nextLine === "    mode tcp" ? runner.originalLineText : "    mode tcp";
      });
    }

    if (fixture.workload === "valid-large" || fixture.workload === "mixed-large") {
      bench(`diagnostics cold: ${fixture.name} unusedSymbols (${lineCount} lines)`, () => {
        runDiagnosticsCold(content, bundle, unusedSymbolOptions);
      });

      bench(
        `diagnostics warm: ${fixture.name} unusedSymbols (${lineCount} lines)`,
        () => {
          runDiagnosticsWarm(
            warmDoc(warmUnusedDocs, fixture.name, content),
            bundle,
            unusedSymbolOptions,
          );
        },
        { warmupIterations: 2 },
      );

      if (fixture.name === "large-valid.cfg") {
        const editLine = findLineContaining(content, "maxconn 200000");
        const runner = createDiagnosticsEditRunner(content, bundle, editLine, unusedSymbolOptions);
        let nextLine = "    maxconn 8192";
        bench(
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
        );
        bench(`diagnostics edit: ${fixture.name} unusedSymbols (global maxconn change)`, () => {
          runner.run(nextLine);
          nextLine = nextLine === "    maxconn 8192" ? runner.originalLineText : "    maxconn 8192";
        });
      } else if (fixture.name === "large-mixed.cfg") {
        const editLine = findLineContaining(content, "timeout server banana");
        const runner = createDiagnosticsEditRunner(content, bundle, editLine, unusedSymbolOptions);
        let nextLine = "    timeout server 30s";
        bench(
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
        );
        bench(`diagnostics edit: ${fixture.name} unusedSymbols (repair invalid timeout)`, () => {
          runner.run(nextLine);
          nextLine =
            nextLine === "    timeout server 30s"
              ? runner.originalLineText
              : "    timeout server 30s";
        });
      }
    }
  }

  bench("diagnostics cold: log-format validation", () => {
    runDiagnosticsCold(logFormatDiagnosticsContent, bundle);
  });

  bench(
    "diagnostics warm: log-format validation",
    () => {
      runDiagnosticsWarm(
        warmDoc(warmDocs, "log-format validation", logFormatDiagnosticsContent),
        bundle,
      );
    },
    { warmupIterations: 2 },
  );
});
