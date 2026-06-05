import { ensureExtensionReady } from "./helpers";

export const mochaHooks = {
  async beforeAll(this: Mocha.Context): Promise<void> {
    this.timeout(30000);
    await ensureExtensionReady();
  },
};
