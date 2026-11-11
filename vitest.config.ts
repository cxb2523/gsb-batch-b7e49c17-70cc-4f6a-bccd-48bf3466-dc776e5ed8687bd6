import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "react-isokit/styles.css": fileURLToPath(new URL("./src/styles.css", import.meta.url)),
      "react-isokit/themes.css": fileURLToPath(new URL("./src/themes.css", import.meta.url)),
      "react-isokit/drafting": fileURLToPath(new URL("./src/drafting.ts", import.meta.url)),
      "react-isokit": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"], tsconfig: "./tsconfig.json" },
  },
})
