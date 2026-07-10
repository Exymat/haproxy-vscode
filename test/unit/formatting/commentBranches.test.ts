import { describe, expect, it } from "vitest";

import { formatConfig, splitLineAtComment } from "../../../src/formatter";
import { formatOptionsWithSchema } from "../../helpers/formatOptions";

describe("formatter comment branch behavior", () => {
  it("splits comment-only lines", () => {
    expect(splitLineAtComment("# comment only")).toEqual({
      code: "",
      commentSuffix: "# comment only",
    });
  });

  it("formats comment-only lines without adding indentation", () => {
    expect(formatConfig("# comment only", formatOptionsWithSchema("3.2"))).toBe("# comment only");
  });
});
