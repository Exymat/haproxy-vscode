import { describe, expect, it } from "vitest";

import { provideCompletionItems } from "../../../src/completion";
import { formatConfig } from "../../../src/formatting";
import { provideHover } from "../../../src/hover";
import { provideDefinition, provideReferences } from "../../../src/navigation";
import { buildSymbolIndex, getSymbolIndex } from "../../../src/symbolIndex";
import { parseDocument } from "../../helpers/parse";
import {
  assertNoErrorDiagnostics,
  diagnosticsForContract,
  loadFixtureContract,
  readIntegrationFixture,
} from "../../helpers/configContracts";
import { createDocument } from "../../helpers/document";
import { formatOptionsWithSchema } from "../../helpers/formatOptions";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle34 = loadSchemaBundle("3.4");

function positionOf(content: string, needle: string, occurrence = 0) {
  let index = -1;
  let searchFrom = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    index = content.indexOf(needle, searchFrom);
    expect(index).toBeGreaterThanOrEqual(0);
    searchFrom = index + needle.length;
  }
  const before = content.slice(0, index).split(/\r?\n/);
  return { line: before.length - 1, character: before[before.length - 1].length };
}

describe("cross-feature contracts on valid configs", () => {
  it("keeps sample.cfg valid across diagnostics, symbols, navigation, completion, and hover", () => {
    const contract = loadFixtureContract("integration", "sample.cfg", "3.2", {
      missingReferences: true,
      unusedSymbols: true,
    });
    const doc = createDocument(contract.content, contract.uri);
    const diagnostics = diagnosticsForContract(contract);
    assertNoErrorDiagnostics(diagnostics, contract.label);

    const index = getSymbolIndex(doc, bundle34.schema, 4000);
    expect(index?.definitions.has("proxy-section:api")).toBe(true);
    expect(index?.definitions.has("proxy-section:web")).toBe(true);

    const apiUseLine = contract.content
      .split(/\r?\n/)
      .findIndex((line) => line.includes("default_backend"));
    const apiUseText = contract.content.split(/\r?\n/)[apiUseLine];
    const apiPos = {
      line: apiUseLine,
      character: apiUseText.indexOf("api", apiUseText.indexOf("default_backend")),
    };
    const defs = provideDefinition(doc, apiPos as never, bundle34.schema, 4000);
    expect(defs).not.toBeNull();

    const bindLine = contract.content.split(/\r?\n/).findIndex((line) => line.includes("bind :"));
    const bindKeywordPos = {
      line: bindLine,
      character: contract.content.split(/\r?\n/)[bindLine].indexOf("bind"),
    };
    const completion = provideCompletionItems(
      doc,
      bindKeywordPos as never,
      bundle34.languageData,
      bundle34.schema,
    );
    expect(completion.length).toBeGreaterThan(0);

    const hover = provideHover(
      doc,
      positionOf(contract.content, "bind") as never,
      bundle34.languageData,
      bundle34.schema,
    );
    expect(hover).not.toBeNull();
  });

  it("keeps symbol-graph.cfg consistent across diagnostics, symbols, and navigation", () => {
    const content = readIntegrationFixture("symbol-graph.cfg");
    const contract = loadFixtureContract("integration", "symbol-graph.cfg", "3.4", {
      missingReferences: true,
      unusedSymbols: false,
    });
    const doc = createDocument(content, contract.uri);
    assertNoErrorDiagnostics(diagnosticsForContract(contract), contract.label);

    const index = buildSymbolIndex(parseDocument(doc, "3.4"), bundle34.schema);
    for (const key of [
      "defaults-profile:profile_default",
      "cache:bench_cache",
      "resolvers:mydns",
      "userlist:stats-auth",
      "peers:mypeers",
      "proxy-section:web",
      "proxy-section:api",
      "acl:frontend:web:is_api",
    ]) {
      expect(index.definitions.has(key), `missing definition ${key}`).toBe(true);
    }

    const aclRefs = provideReferences(
      doc,
      positionOf(content, "is_api", 1) as never,
      { includeDeclaration: true },
      bundle34.schema,
      4000,
    );
    expect(aclRefs.map((location) => location.range.start.line).sort((a, b) => a - b)).toEqual([
      positionOf(content, "acl is_api").line,
      positionOf(content, "api if is_api").line,
    ]);

    const backendDefs = provideDefinition(
      doc,
      positionOf(content, "api if is_api") as never,
      bundle34.schema,
      4000,
    );
    expect(backendDefs).not.toBeNull();
  });

  it("formats messy-format.cfg without introducing diagnostics", () => {
    const content = readIntegrationFixture("messy-format.cfg");
    const formatted = formatConfig(content, formatOptionsWithSchema("3.2"));
    expect(formatted).toBe("frontend foo\n    mode http # or tcp\n");

    const contract = loadFixtureContract("integration", "messy-format.cfg", "3.2");
    const formattedDoc = createDocument(formatted, contract.uri);
    const diagnostics = diagnosticsForContract({
      ...contract,
      content: formatted,
      label: `${contract.label} (formatted)`,
    });
    assertNoErrorDiagnostics(diagnostics, contract.label);

    const originalDiagnostics = diagnosticsForContract(contract);
    assertNoErrorDiagnostics(originalDiagnostics, contract.label);
    expect(formattedDoc.getText()).toContain("frontend foo");
  });
});
