#!/usr/bin/env node
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"))
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d }
const all = (k) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []))
if (!url) { console.error("usage: node shoot.mjs <url> [--selector .ik-plate] [--click <button label>]... [--out dir]"); process.exit(2) }

let chromium
try { ({ chromium } = await import("playwright-core")) } catch { console.error("playwright-core is missing: npm i -D playwright-core"); process.exit(2) }
const launch = async () => { for (const channel of ["chrome", "chromium", undefined]) { try { return await chromium.launch({ channel, headless: true }) } catch {} } console.error("No Chrome or Chromium found: npx playwright install chromium"); process.exit(2) }

const selector = opt("selector", ".ik-plate"), out = opt("out", "isokit-shots"), clicks = all("click")
mkdirSync(out, { recursive: true })
const browser = await launch()
let failed = false

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme })
  const errors = []
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.waitForSelector(".ik-plate svg", { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(120)
  await page.evaluate(() => { for (const svg of document.querySelectorAll(".ik-plate svg")) svg.dispatchEvent(new PointerEvent("pointerdown", { button: 2, bubbles: true })) })
  await page.waitForLoadState("networkidle")
  await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme)
  const plates = page.locator(selector)
  const count = await plates.count()
  if (!count) { console.log(`✗ ${theme} ${width}px: nothing matches ${selector}`); failed = true; await page.close(); continue }
  const readouts = async () => Promise.all(Array.from({ length: count }, (_, i) => plates.nth(i).locator("[aria-live]").first().textContent().catch(() => "")))
  for (let i = 0; i < count; i++) { await plates.nth(i).scrollIntoViewIfNeeded(); await page.waitForTimeout(900); await plates.nth(i).screenshot({ path: join(out, `${theme}-${width}-${i}-rest.png`) }) }
  const before = await readouts()
  for (const name of clicks) {
    const inPlate = plates.first().getByRole("button", { name, exact: true })
    const part = (await inPlate.count()) ? inPlate.first() : page.getByRole("button", { name, exact: true }).first()
    await part.focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(clicks.length > 1 ? 400 : 0)
  }
  await page.waitForTimeout(clicks.length ? 1200 : 0)
  const after = await readouts()
  for (let i = 0; i < count && clicks.length; i++) await plates.nth(i).screenshot({ path: join(out, `${theme}-${width}-${i}-pressed.png`) })
  for (let i = 0; i < count; i++) console.log(`${theme} ${width}px plate ${i}: "${before[i]}"${clicks.length ? ` → "${after[i]}"` : ""}`)
  if (clicks.length && before.every((b, i) => b === after[i])) { console.log(`✗ ${theme} ${width}px: the presses changed no read-out`); failed = true }
  if (errors.length) { console.log(`✗ ${theme} ${width}px console:\n  ${errors.join("\n  ")}`); failed = true }
  await page.close()
}
await browser.close()
console.log(failed ? "\nSome checks failed." : `\nAll clean. Pictures in ${out}/ — now look at them against references/rules.md.`)
process.exit(failed ? 1 : 0)
