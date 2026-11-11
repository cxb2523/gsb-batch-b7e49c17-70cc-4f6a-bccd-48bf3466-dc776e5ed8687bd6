import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: process.env.DEMO_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "react-isokit/styles.css": fileURLToPath(new URL("../../src/styles.css", import.meta.url)),
      "react-isokit/themes.css": fileURLToPath(new URL("../../src/themes.css", import.meta.url)),
      "react-isokit/drafting": fileURLToPath(new URL("../../src/drafting.ts", import.meta.url)),
      "react-isokit": fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
})
