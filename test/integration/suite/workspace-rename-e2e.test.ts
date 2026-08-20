import * as assert from "node:assert";

import {
  ensureHaproxyVersion,
  openFixture,
  positionOf,
  renameEditsAt,
  resetHaproxySettings,
  updateHaproxySetting,
  waitForReferenceUris,
} from "./helpers";

suite("Workspace rename E2E", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    await resetHaproxySettings();
    await ensureHaproxyVersion("3.2");
    await updateHaproxySetting("workspaceSymbols.enabled", true);
    await updateHaproxySetting("workspaceSymbols.include", ["**/workspace-symbols/**/*.cfg"]);
    await updateHaproxySetting("workspaceSymbols.exclude", []);
    await updateHaproxySetting("workspaceSymbols.maxFiles", 20);
    await updateHaproxySetting("workspaceSymbols.debounceMs", 100);
  });

  suiteTeardown(async () => {
    await resetHaproxySettings();
  });

  test("rename updates backend references across indexed workspace files", async () => {
    const frontend = await openFixture("workspace-symbols/frontends/web.cfg");
    const backend = await openFixture("workspace-symbols/backends/api.cfg");

    await waitForReferenceUris(backend.uri, positionOf(backend, "api"), [
      "/workspace-symbols/backends/api.cfg",
      "/workspace-symbols/frontends/web.cfg",
    ]);

    const edit = await renameEditsAt(frontend.uri, positionOf(frontend, "api"), "api-renamed");
    assert.ok(edit, "Expected rename workspace edit");

    const frontendChange = edit.get(frontend.uri)?.[0];
    const backendChange = edit.get(backend.uri)?.[0];
    assert.ok(frontendChange, "Expected frontend rename edit");
    assert.ok(backendChange, "Expected backend rename edit");
    assert.strictEqual(frontendChange.newText, "api-renamed");
    assert.strictEqual(backendChange.newText, "api-renamed");
  });
});
