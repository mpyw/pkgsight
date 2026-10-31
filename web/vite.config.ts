import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The bundle ships inside the binary and loads from localhost, so the
  // size of elkjs (about 1.5 MB) costs nothing worth splitting for.
  build: { chunkSizeWarningLimit: 2500 },
  server: {
    // `pkgsight serve -open=false` answers the API while vite serves the app.
    proxy: { "/api": "http://localhost:7878" },
  },
  test: {
    // Component tests ask for jsdom with a `@vitest-environment` comment.
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/main.tsx",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/vite-env.d.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
