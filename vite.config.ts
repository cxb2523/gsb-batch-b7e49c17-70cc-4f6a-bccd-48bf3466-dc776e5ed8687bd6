import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      // 点选/悬停验证页：npm run dev 后访问 /verify.html
      input: ["index.html", "verify.html"],
    },
  },
  server: {
    host: true,
  },
});
