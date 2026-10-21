import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    env: {
      // Placeholder: unit tests never open a connection, but the db module
      // requires the variable to exist at import time.
      DATABASE_URL: "postgres://placeholder:placeholder@127.0.0.1:59999/placeholder",
      SESSION_PEPPER: "vitest-pepper",
    },
  },
});
