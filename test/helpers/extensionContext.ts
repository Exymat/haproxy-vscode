import { join } from "node:path";

import { createMockExtensionContext } from "../__mocks__/vscode";

const extensionRoot = join(__dirname, "..", "..");

export function mockExtensionContext() {
  return createMockExtensionContext(extensionRoot);
}
