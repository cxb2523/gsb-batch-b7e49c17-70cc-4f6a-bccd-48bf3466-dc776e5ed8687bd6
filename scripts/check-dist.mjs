import { readFileSync } from "node:fs"

const code = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8")
if (!code.includes('process.env.NODE_ENV !== "production"')) {
  console.error("dist/index.js has NODE_ENV inlined: the development checks would ship to production.")
  process.exit(1)
}
console.log("dist keeps process.env.NODE_ENV for the app's bundler")
