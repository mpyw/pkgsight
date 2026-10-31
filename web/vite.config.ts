import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The bundle ships inside the binary and loads from localhost, so the
  // size of elkjs (about 1.5 MB) costs nothing worth splitting for.
  build: { chunkSizeWarningLimit: 2500 },
  server: {
    // `pkgsight serve -open=false` answers the API while vite serves the app.
    proxy: { "/api": "http://localhost:7878" },
  },
});
