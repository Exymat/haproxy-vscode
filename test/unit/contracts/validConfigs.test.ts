import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  diagnosticsForContract,
  errorDiagnostics,
  loadFixtureContract,
  type ValidConfigContract,
} from "../../helpers/configContracts";
import type { SupportedVersion } from "../../helpers/schema";

const validUpstreamDir = join(__dirname, "..", "..", "fixtures", "valid-upstream");

const VALID_CONFIG_CONTRACTS: Array<
  ValidConfigContract & {
    source: "fixtures" | "golden" | "integration" | "valid-upstream";
    path: string;
  }
> = [
  {
    label: "integration/sample.cfg",
    source: "integration",
    path: "sample.cfg",
    versions: ["3.2", "3.4"],
    options: { missingReferences: true, unusedSymbols: true },
  },
  {
    label: "integration/valid-basic-check.cfg",
    source: "integration",
    path: "valid-basic-check.cfg",
    versions: ["3.2", "3.4"],
    options: { missingReferences: true, unusedSymbols: true },
  },
  {
    label: "fixtures/basic-check-snippet.cfg",
    source: "fixtures",
    path: "basic-check-snippet.cfg",
    versions: ["3.2", "3.4"],
    options: { missingReferences: true, unusedSymbols: true },
  },
  {
    label: "fixtures/use_backend-var.cfg",
    source: "fixtures",
    path: "use_backend-var.cfg",
    versions: ["3.2", "3.4"],
    options: { missingReferences: true, unusedSymbols: false },
  },
  {
    label: "golden/test-log-format-bracket-expr.cfg",
    source: "golden",
    path: "test-log-format-bracket-expr.cfg",
    versions: ["3.2", "3.4"],
    options: { missingReferences: false, unusedSymbols: false },
  },
  {
    label: "integration/symbol-graph.cfg",
    source: "integration",
    path: "symbol-graph.cfg",
    versions: ["3.4"],
    options: { missingReferences: true, unusedSymbols: false },
  },
  {
    label: "integration/messy-format.cfg",
    source: "integration",
    path: "messy-format.cfg",
    versions: ["3.2", "3.4"],
    options: { missingReferences: false, unusedSymbols: false },
  },
];

function listValidUpstreamFixtures(): string[] {
  return readdirSync(validUpstreamDir)
    .filter((name) => name.endsWith(".cfg"))
    .sort();
}

describe("valid HAProxy config contracts", () => {
  it.each(
    VALID_CONFIG_CONTRACTS.flatMap((entry) =>
      entry.versions.map(
        (version) => [entry.label, entry.source, entry.path, version, entry.options] as const,
      ),
    ),
  )("%s@%s has no error diagnostics", (_label, source, path, version, options) => {
    const contract = loadFixtureContract(source, path, version, options);
    expect(errorDiagnostics(diagnosticsForContract(contract))).toEqual([]);
  });

  it.each(
    listValidUpstreamFixtures().flatMap((fileName) =>
      (["2.6", "2.8", "3.0", "3.2", "3.4"] as SupportedVersion[]).map(
        (version) => [fileName, version] as const,
      ),
    ),
  )("valid-upstream/%s@%s has no error diagnostics", (fileName, version) => {
    const contract = loadFixtureContract("valid-upstream", fileName, version, {
      missingReferences: true,
      unusedSymbols: false,
    });
    expect(errorDiagnostics(diagnosticsForContract(contract))).toEqual([]);
  });
});
