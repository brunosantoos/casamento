import { defineConfig } from "vitest/config";

// Banco de teste isolado (nunca o de desenvolvimento). Ver docs/testes.md.
export const TEST_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://brunocristiano@localhost:5432/casamento_test",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
  MASTER_KEY: "0".repeat(64),
  WEB_ORIGIN: "http://localhost:5190",
  API_URL: "http://localhost:4100",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: ".storage-test",
  NODE_ENV: "test",
};

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
