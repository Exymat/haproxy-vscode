import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Symbol settings command", () => {
  test("opens Settings and returns without serializing the editor pane", async function () {
    this.timeout(15000);
    const extension = vscode.extensions.getExtension("Exymat.haproxy-config");
    assert.ok(extension);
    await extension.activate();
    const document = await vscode.workspace.openTextDocument({
      language: "haproxy",
      content: "backend api\n" + "  # padding\n".repeat(4100),
    });
    await vscode.window.showTextDocument(document);
    try {
      const result = await vscode.commands.executeCommand("haproxy.openSymbolLinesSettings");
      assert.strictEqual(result, undefined);
      // Another round trip proves the renderer still processes extension requests.
      assert.ok((await vscode.commands.getCommands()).includes("haproxy.openSymbolLinesSettings"));
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  });
});
