import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    globals: true,
    testTimeout: 10000,
    server: {
      deps: {
        external: [/node:sqlite/, "sqlite", "node:sqlite"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite"],
  },
});
