import { describe, expect, it } from "vitest";

import { hoverMarkdown } from "./helpers";

describe("directive hover documentation completeness", () => {
  it.each(["3.0", "3.2", "3.4"] as const)(
    "documents capture request header prose after arguments for %s",
    (version) => {
      const line = "    capture request header Host len 32";
      const text = hoverMarkdown(
        `frontend web\n${line}`,
        1,
        line.indexOf("capture request header") + 10,
        version,
      );
      expect(text).toContain("capture request header");
      expect(text.toLowerCase()).toContain("capture and log the last occurrence");
      expect(text).toContain("complete value of the last occurrence");
      expect(text).toContain("User-agent");
    },
  );

  it.each(["3.0", "3.2", "3.4"] as const)("documents http-request full prose for %s", (version) => {
    const line = "    http-request deny";
    const text = hoverMarkdown(
      `frontend web\n${line}`,
      1,
      line.indexOf("http-request") + 3,
      version,
    );
    expect(text).toContain("http-request statement");
    expect(text).toContain("**Example**");
  });
});
