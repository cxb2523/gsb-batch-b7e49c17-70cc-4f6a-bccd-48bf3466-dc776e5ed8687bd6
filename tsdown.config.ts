import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const nativeRequireCjs = fileURLToPath(new URL("./src/native-require-cjs.ts", import.meta.url));

export default defineConfig([
  {
    entry: ["src/wreq-js.ts"],
    format: "esm",
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
    platform: "node",
    fixedExtension: false,
    outDir: "dist",
    deps: {
      neverBundle: [/\\.node$/],
      alwaysBundle: ["./types.js", "./generated-types.js"],
    },
    outputOptions: {
      exports: "named",
    },
  },
  {
    entry: ["src/wreq-js.ts"],
    format: "cjs",
    dts: false,
    sourcemap: true,
    target: "node20",
    platform: "node",
    outDir: "dist",
    alias: {
      "./native-require.js": nativeRequireCjs,
    },
    deps: {
      neverBundle: [/\\.node$/],
      alwaysBundle: ["./types.js", "./generated-types.js"],
    },
    outExtensions: () => ({
      js: ".cjs",
    }),
    outputOptions: {
      exports: "named",
    },
  },
]);
