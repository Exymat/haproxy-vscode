import { describe, expect, it, vi } from "vitest";

import { tryUseServiceCompletion } from "../../../src/completion/handlers/useService";
import * as documentContext from "../../../src/parser/documentContext";
import { completionLabels } from "./helpers";

describe("tryUseServiceCompletion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null outside use-service action position", () => {
    expect(tryUseServiceCompletion).toBeDefined();
    expect(completionLabels("frontend web\n    bind :80 ", 1)).not.toContain("ping");
  });

  it("returns service names for use-service actions", () => {
    const origGroupItems = documentContext.groupItems;
    vi.spyOn(documentContext, "groupItems").mockImplementation((data, group) => {
      if (group === "services") {
        return [{ name: "ping", description: "ping service", signature: "ping", rulesets: [] }];
      }
      return origGroupItems(data, group);
    });
    expect(completionLabels("frontend web\n    http-request use-service ", 1)).toContain("ping");
  });
});
