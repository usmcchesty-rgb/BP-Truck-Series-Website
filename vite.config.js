import { defineConfig } from "vite";

export default defineConfig({
  root: "./public",
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
});
