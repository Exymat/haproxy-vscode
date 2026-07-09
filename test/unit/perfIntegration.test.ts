import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { benchFixturePath } from "../bench/helpers";

describe("benchFixturePath", () => {
  it("resolves bench fixtures from the source tree", () => {
    const path = benchFixturePath("large-valid.cfg");
    expect(existsSync(path)).toBe(true);
    expect(path.replace(/\\/g, "/")).toContain("/test/bench/fixtures/large-valid.cfg");
  });
});

describe("check-perf-integration-thresholds.mjs", () => {
  const sampleReport = join(__dirname, "../bench/fixtures/perf-integration-report.sample.json");

  it("passes for a report within configured limits", () => {
    const result = spawnSync(
      "node",
      ["scripts/check-perf-integration-thresholds.mjs", sampleReport],
      { cwd: join(__dirname, "../.."), encoding: "utf-8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("All configured integration perf thresholds passed.");
  });
});
