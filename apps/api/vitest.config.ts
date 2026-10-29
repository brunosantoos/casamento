import { defineConfig } from "vitest/config";
import { TEST_ENV } from "../../packages/core/vitest.config.js";

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: ["../../packages/core/test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
