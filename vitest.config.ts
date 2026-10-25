import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, TURNSTILE_SECRET: "test-secret" },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      coverage: {
        // The Workers runtime has no V8 coverage hook, so istanbul instruments instead.
        provider: "istanbul" as const,
        include: ["src/**/*.ts"],
        // 100% is the bar (spec, engineering requirements). Anything excluded
        // must say why inline with an istanbul ignore comment.
        thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
        reporter: ["text", "html", "lcov"],
      },
    },
  };
});
