import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Counters } from "../src/schema/index.js";
import { inferDefaultLocale, knownLocales, localeSampleFor } from "../src/parser/nextjs-app-router/locale-samples.js";

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "code2flow-i18n-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, content);
  }
  return dir;
}

describe("inferDefaultLocale (next-intl routing → concrete [locale] samples)", () => {
  it("reads defaultLocale from the next-intl defineRouting config and counts it as routing-sourced", () => {
    const root = repo({ "src/i18n/routing.ts": 'import { defineRouting } from "next-intl/routing";\nexport const routing = defineRouting({ locales: ["vi", "en"], defaultLocale: "vi", localePrefix: "as-needed" });' });
    const counters: Counters = {};
    expect(inferDefaultLocale(root, counters)).toBe("vi");
    expect(counters["src/i18n/routing.ts"]?.["locale-default-from-routing"]).toBe(1);
    expect(knownLocales(root)).toEqual(["vi", "en"]);
  });

  it("falls back to the first declared locale when defaultLocale is absent, counted as a guess", () => {
    const root = repo({ "src/i18n/routing.ts": "export const routing = { locales: [\"fr\", \"de\"] };" });
    const counters: Counters = {};
    expect(inferDefaultLocale(root, counters)).toBe("fr");
    expect(counters["src/i18n/routing.ts"]?.["locale-default-guessed-first"]).toBe(1);
    expect(counters["src/i18n/routing.ts"]?.["locale-default-from-routing"]).toBeUndefined();
  });

  it("falls back to messages/*.json when no routing config exists", () => {
    const root = repo({ "messages/en.json": "{}", "messages/vi.json": "{}" });
    const counters: Counters = {};
    expect(inferDefaultLocale(root, counters)).toBe("en"); // sorted, first wins
    expect(counters["messages"]?.["locale-default-guessed-first"]).toBe(1);
    expect(knownLocales(root)).toEqual(["en", "vi"]);
  });

  it("returns null without bumping anything when the repo gives no locale hint", () => {
    const root = repo({ "package.json": "{}" });
    const counters: Counters = {};
    expect(inferDefaultLocale(root, counters)).toBeNull();
    expect(counters).toEqual({});
  });
});

describe("localeSampleFor", () => {
  it("replaces only the [locale]-style segment and leaves other dynamic segments for later discovery", () => {
    expect(localeSampleFor("/[locale]/about", "vi")).toBe("/vi/about");
    expect(localeSampleFor("/[lang]/products/[slug]", "en")).toBeNull(); // [slug] still needs a real example
    expect(localeSampleFor("/[language]", "en")).toBe("/en");
    expect(localeSampleFor("/blog/[slug]", "en")).toBeNull(); // no locale segment at all
  });
});
