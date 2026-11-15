import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

// In development every /api request is proxied to the backend, so the browser
// only ever talks to one origin (no CORS or third-party-cookie problems).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_DEV_BACKEND_URL || "http://localhost:5001";
  return {
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true,
      // Regex keys: a plain "/api" prefix would also swallow the SPA routes
      // /api-status and /api-reference.
      proxy: {
        "^/api/.*": { target: backend, changeOrigin: true },
        "^/api-docs(/.*)?$": { target: backend, changeOrigin: true },
        "^/(uploads|media)/.*": { target: backend, changeOrigin: true },
        "^/img\\?.*": { target: backend, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        "^/api/.*": { target: backend, changeOrigin: true },
        "^/api-docs(/.*)?$": { target: backend, changeOrigin: true },
        "^/(uploads|media)/.*": { target: backend, changeOrigin: true },
        "^/img\\?.*": { target: backend, changeOrigin: true },
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            charts: ["recharts"],
            maps: ["leaflet", "react-leaflet"],
          },
        },
      },
    },
  };
});
