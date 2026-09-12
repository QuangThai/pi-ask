import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/cli.e2e.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One pi process at a time keeps the output readable and the ports stable.
    fileParallelism: false,
  },
});
