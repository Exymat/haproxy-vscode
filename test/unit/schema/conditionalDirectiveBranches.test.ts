import { describe, expect, it } from "vitest";

import {
  conditionalBlocksDocsUrl,
  lookupConditionalDirective,
} from "../../../src/conditionalDirectives";

describe("conditional directive metadata branch behavior", () => {
  it("handles missing directive maps", () => {
    expect(lookupConditionalDirective({} as never, ".if")).toBeUndefined();
    expect(conditionalBlocksDocsUrl({} as never, "3.4")).toBe(
      "https://docs.haproxy.org/3.4/configuration.html#2.4",
    );
  });
});
