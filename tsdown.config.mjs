import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/index.ts", schema: "src/schema.ts", drafting: "src/drafting.ts" },
  format: "esm",
  platform: "neutral",
  target: "es2020",
  dts: true,
  sourcemap: true,
  clean: true,
  hash: false,
  fixedExtension: false,
  outputOptions: { banner: (chunk) => (chunk.isEntry && chunk.name === "index" ? '"use client";' : "") },
  copy: [
    { from: "src/styles.css", to: "dist" },
    { from: "src/themes.css", to: "dist" },
  ],
})
