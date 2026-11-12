import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { scanCommand } from "../src/cli/scan-command.js";
import { featureIdFor } from "../src/schema/index.js";
import { defaultFeatures } from "../src/viewer/data-model.js";

// A minimal, self-contained next-intl app: every route sits under [locale]; next-intl's routing file
// declares `defaultLocale: "vi"`. The home page mixes prefixed links, unprefixed literals (one with an
// anchor) and decorative components whose `to` props carry colour tokens instead of paths. No network needed.
const SOURCE = fileURLToPath(new URL("../fixtures/synthetic/app-router-locale", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "code2flow-locale-"));
cpSync(SOURCE, dir, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("locale samples and prop path shape (seam: scan → .code2flow files)", () => {
  it("fills [locale] with the next-intl default locale and ignores non-path `to` props", async () => {
    const r = await scanCommand(dir, () => {});
    const samples = JSON.parse(readFileSync(join(r.outDir, "route-samples.json"), "utf8"));
    // (1) default-locale inference: the [locale] dynamic segment is sampled with the inferred locale, so it never lands in needsSample
    expect(samples.samples["/[locale]"]).toEqual(["/vi"]);
    expect(samples.samples["/[locale]/about"]).toEqual(["/vi/about"]); // the unprefixed literal /about#team is sampled WITH the locale prefix
    expect(samples.needsSample).toEqual([]);
    const graph = JSON.parse(readFileSync(join(r.outDir, "graph.json"), "utf8"));
    // the inference is auditable in counters: it came from next-intl's routing file, not a hardcoded guess
    expect(graph.counters["src/i18n/routing.ts"]["locale-default-from-routing"]).toBe(1);
    expect(graph.counters["route-samples"]["locale-sample-inferred"]).toBe(1); // /[locale]/about already had the literal /vi/about; only /[locale] needed the locale
    expect(graph.counters["route-samples"]["needs-sample"] ?? 0).toBe(0);
    // unprefixed-link resolution is inference too: every bare literal that lands on a [locale] route is counted
    expect(graph.counters["route-registry"]["locale-prefix-inferred"]).toBeGreaterThan(0);
    // (4) decorative props without any path character (`brand-cream`, `accent-sunset-soft`) are counted as skips, never edges or missing: targets
    expect(graph.counters["app/[locale]/page.tsx"]["prop-value-not-a-path"]).toBe(3); // SectionDivider to= + two BrandButton to=
    expect(graph.edges.some((e: { target: string }) => /brand|accent/.test(e.target))).toBe(false);
    expect(graph.edges.some((e: { source: string; target: string }) => e.source === "/[locale]" && e.target === "/[locale]/about")).toBe(true);
    // (2) links written without the locale prefix (next-intl `localePrefix: "as-needed"`) still resolve to the [locale] route
    expect(graph.edges.some((e: { source: string; target: string; href?: string }) => e.href === "/about" && e.target === "/[locale]/about")).toBe(true);
    // (3) unprefixed links carrying an anchor resolve the same way; the hash does not produce a missing: target
    expect(graph.edges.some((e: { source: string; target: string; href?: string }) => e.href === "/about#team" && e.target === "/[locale]/about")).toBe(true);
    expect(graph.edges.some((e: { source: string; target: string; href?: string }) => e.href === "/about#contact" && e.target === "/[locale]/about")).toBe(true);
    expect(graph.edges.some((e: { target: string }) => e.target.startsWith("missing:"))).toBe(false);
  });

  it("derives features past a leading [locale] segment", () => {
    const features = defaultFeatures(["/[locale]", "/[locale]/kien-thuc", "/[locale]/kien-thuc/xoai", "/[locale]/bang-gia", "/[locale]/[product]"]);
    expect(features.map((f) => f.id)).toEqual(expect.arrayContaining(["kien-thuc", "bang-gia", "account"]));
    expect(features.map((f) => f.id)).not.toContain("locale");
    expect(features.find((f) => f.id === "product")?.title).toBe("Product"); // a dynamic top segment names its feature without brackets
    expect(featureIdFor("/[locale]/[product]", features)).toBe("product");
    expect(featureIdFor("/[locale]/kien-thuc/xoai", features)).toBe("kien-thuc");
    expect(featureIdFor("/[locale]", features)).toBe("account"); // the localized root is the home screen
  });
});
