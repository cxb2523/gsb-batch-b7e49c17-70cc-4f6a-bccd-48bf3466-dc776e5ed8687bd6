import { createRequire } from "node:module";

export const nativeRequire = createRequire(import.meta.url);
