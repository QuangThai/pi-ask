import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The CLI end-to-end suite spawns a pi process per case; it runs through
    // `npm run e2e` with its own config and a longer timeout.
    exclude: ["node_modules/**", "tests/e2e/cli.e2e.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
