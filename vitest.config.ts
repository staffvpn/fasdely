import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["supabase/functions/**/*.test.ts"],
    environment: "node",
  },
});
