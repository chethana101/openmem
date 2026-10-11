import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globals: true,
    testTimeout: 10000,
    server: {
      deps: {
        external: [/node:sqlite/, "sqlite", "node:sqlite"],
      },
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite"],
  },
});
