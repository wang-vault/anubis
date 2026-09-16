import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // JSX otomatis (tanpa `import React`) — sama seperti Next.js di aplikasi.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub "server-only" agar unit test murni bisa meng-import modul server.
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
