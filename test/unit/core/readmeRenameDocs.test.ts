import { readFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync(join(__dirname, "../../../README.md"), "utf8");

describe("README rename documentation", () => {
  it("does not claim rename is single-file when the workspace graph is active", () => {
    expect(readme).not.toMatch(
      /definitions and references can span multiple `\.cfg` files; rename remains single-file/i,
    );
    expect(readme).not.toMatch(/all in-scope references in the \*\*current file\*\* are updated/i);
  });

  it("documents cross-file rename and environment-variable scope", () => {
    expect(readme).toMatch(/across indexed `\.cfg` files/i);
    expect(readme).toMatch(/Environment variable rename remains single-file/i);
    expect(readme).toMatch(/haproxy\.workspaceSymbols\.include/i);
    expect(readme).toMatch(/same-scope collisions/i);
  });
});
