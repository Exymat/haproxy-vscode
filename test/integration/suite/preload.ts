import { ensureExtensionReady } from "./helpers";

export const mochaHooks = {
  async beforeAll(this: Mocha.Context): Promise<void> {
    if (process.env.HAPROXY_PERF_BENCH === "1") {
      return;
    }
    this.timeout(30000);
    await ensureExtensionReady();
  },
};
