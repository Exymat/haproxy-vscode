import { describe, expect, it } from "vitest";

import {
  assertDiagnosticLines,
  diagnosticsForContract,
  errorDiagnostics,
  loadFixtureContract,
} from "../../helpers/configContracts";
import type { SupportedVersion } from "../../helpers/schema";

const ADDRESS_CODES = [
  "invalid-address",
  "missing-port",
  "port-not-permitted",
  "port-range-not-permitted",
  "port-offset-not-permitted",
  "invalid-port",
];

const SAMPLE_CODES = [
  "sample-missing-fetch",
  "sample-unknown-fetch",
  "sample-fetch-args",
  "sample-unknown-converter",
  "sample-converter-args",
  "sample-converter-cast",
  "sample-syntax",
];

const PORTS_EXPECTED_LINES = [
  7, 8, 9, 11, 15, 16, 17, 20, 21, 22, 23, 24, 25, 30, 31, 32, 40, 48, 49, 55, 56, 57, 60, 63, 64,
  65, 72, 73, 74,
];

const GOLDEN_CONTRACTS: Array<{
  file: string;
  versions: SupportedVersion[];
  codes: string[];
  lines: number[];
  expectNoErrors?: boolean;
}> = [
  {
    file: "ports.cfg",
    versions: ["3.4"],
    codes: ADDRESS_CODES,
    lines: PORTS_EXPECTED_LINES,
  },
  {
    file: "test-valid-names.cfg",
    versions: ["3.4"],
    codes: ["invalid-name"],
    lines: [23, 30],
  },
  {
    file: "test-acl-args.cfg",
    versions: ["3.4"],
    codes: SAMPLE_CODES,
    lines: [15, 18, 21, 26, 29, 32, 35],
  },
  {
    file: "test-sample-fetch-args.cfg",
    versions: ["3.4"],
    codes: SAMPLE_CODES,
    lines: [15, 18, 21, 26, 29, 32, 35],
  },
  {
    file: "test-sample-fetch-conv.cfg",
    versions: ["3.4"],
    codes: SAMPLE_CODES,
    lines: [15, 18, 21, 24, 29, 35, 38, 41],
  },
  {
    file: "test-address-syntax.cfg",
    versions: ["3.4"],
    codes: ["extra-argument"],
    lines: [12, 14, 18, 20, 22, 42, 50, 57, 64, 71, 78],
  },
  {
    file: "test-log-format-bracket-expr.cfg",
    versions: ["3.4"],
    codes: [],
    lines: [],
    expectNoErrors: true,
  },
];

describe("golden diagnostic contracts", () => {
  it.each(
    GOLDEN_CONTRACTS.flatMap((entry) =>
      entry.versions.map((version) => [entry.file, version, entry] as const),
    ),
  )("golden/%s@%s matches expected diagnostic lines", (fileName, version, entry) => {
    const contract = loadFixtureContract("golden", fileName, version);
    const diagnostics = diagnosticsForContract(contract);

    expect(() => {
      if (entry.expectNoErrors) {
        const errors = errorDiagnostics(diagnostics);
        if (errors.length > 0) {
          throw new Error(`${contract.label}: expected no error diagnostics`);
        }
        return;
      }
      assertDiagnosticLines(diagnostics, entry.codes, entry.lines, contract.label);
    }).not.toThrow();
  });
});
