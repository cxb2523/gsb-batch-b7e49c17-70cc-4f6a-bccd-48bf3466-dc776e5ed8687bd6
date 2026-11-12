/**
 * End-to-end tests for the extraction link that carries a document's number
 * convention, derived from its `lang`, into every cell's parse. The parser
 * itself is covered in parse.test.ts; here the same cell text is extracted
 * from real <table> markup under German, English, missing-lang, and Spanish
 * pages and parsed with the convention the page implies.
 *
 * jsdom lacks innerText and checkVisibility, so the test installs the
 * textContent fallback cellText already knows and a display/visibility-based
 * checkVisibility with the semantics the extractor relies on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { extractPage, extractTable } from "../src/dom/extract.ts";
import { conventionForLang, parseNumber } from "../src/core/parse.ts";
import { profileTable } from "../src/core/profile.ts";
import type { NumberConvention } from "../src/core/parse.ts";

/** Builds a document with the given `lang` (omit to leave <html> without one). */
const render = (html: string, lang?: string): Document => {
  const dom = new JSDOM(
    `<!doctype html><html${lang === undefined ? "" : ` lang="${lang}"`}><body>${html}</body></html>`,
  );
  const window = dom.window;
  // The extractor references DOM globals (Node, HTMLElement) as ambient globals.
  globalThis.Node ??= window.Node;
  globalThis.HTMLElement ??= window.HTMLElement;
  globalThis.Element ??= window.Element;
  if (typeof window.Element.prototype.checkVisibility !== "function") {
    // jsdom has no layout engine; model the display:none / visibility:hidden /
    // hidden semantics the extractor's isHiddenCell and textSkipping rely on.
    window.Element.prototype.checkVisibility = function (this: Element) {
      if (!this.isConnected) return false;
      const style = window.getComputedStyle(this);
      return style.display !== "none" && style.visibility !== "hidden" && !(this as HTMLElement).hidden;
    };
  }
  return window.document;
};

const PAGE = `
<h1>Locale table</h1>
<table id="zahlen">
  <thead><tr><th>Name</th><th>Wert</th><th>Dauer</th></tr></thead>
  <tbody>
    <tr><td>A</td><td>22 (13,1%)</td><td>1544:10</td></tr>
    <tr><td>B</td><td>1.299,00 €</td><td>2:59</td></tr>
    <tr><td>C</td><td>1.5</td><td>0:57</td></tr>
    <tr><td>D</td><td>1,234,567</td><td>3:00</td></tr>
  </tbody>
</table>`;

/** Extracts the only table and parses each cell of one column with the page's convention. */
const extractColumn = (doc: Document, col: number) => {
  const { page, tables } = extractPage(doc);
  assert.equal(tables.length, 1);
  const convention = conventionForLang(page.lang);
  const cells = tables[0]!.snapshot.rows.map((row) => row[col] ?? "");
  return { lang: page.lang, convention, cells, parsed: cells.map((cell) => parseNumber(cell, convention)) };
};

test("a German page reads comma decimals and dot thousands through extraction", () => {
  const doc = render(PAGE, "de");
  const { lang, convention, cells, parsed } = extractColumn(doc, 1);
  assert.equal(lang, "de");
  assert.equal(convention, "comma-decimal");
  assert.deepEqual(cells, ["22 (13,1%)", "1.299,00 €", "1.5", "1,234,567"]);
  // The count-share uses the German comma decimal: 22, not text.
  assert.deepEqual(parsed[0], { value: 22, unit: null, bound: false, range: null });
  // A German price keeps its thousands dots and comma decimal, and the euro is the unit.
  assert.deepEqual(parsed[1], { value: 1299, unit: "€", bound: false, range: null });
  // Writing that does not fit the German convention stays text instead of a guessed number.
  assert.equal(parsed[2], null, "1.5 is a dot decimal on a comma-decimal page");
  assert.equal(parsed[3], null, "1,234,567 uses comma thousands on a comma-decimal page");

  // Clock durations are base-60 in every convention, untouched by decimal rules.
  const durations = extractColumn(doc, 2);
  assert.deepEqual(
    durations.parsed.map((p) => p?.value),
    [92650, 179, 57, 180],
  );
  assert.ok(durations.parsed.every((p) => p?.unit === ":"));
});

test("an English page keeps the dot-decimal reading through extraction", () => {
  const doc = render(PAGE, "en");
  const { lang, convention, parsed } = extractColumn(doc, 1);
  assert.equal(lang, "en");
  assert.equal(convention, "dot-decimal");
  // The same count-share text stays text on an English page: the share's comma is not a decimal there.
  assert.equal(parsed[0], null, "22 (13,1%) is text on an English page");
  assert.equal(parsed[1], null, "1.299,00 € is text on an English page");
  assert.deepEqual(parsed[2], { value: 1.5, unit: null, bound: false, range: null });
  assert.deepEqual(parsed[3], { value: 1234567, unit: null, bound: false, range: null });
  // The duration column parses identically regardless of convention.
  const durations = extractColumn(doc, 2).parsed.map((p) => p?.value);
  assert.deepEqual(durations, [92650, 179, 57, 180]);
});

test("a page without a lang attribute keeps the existing English behavior", () => {
  const doc = render(PAGE);
  const { lang, convention, parsed } = extractColumn(doc, 1);
  assert.equal(lang, "");
  assert.equal(convention, "dot-decimal");
  assert.equal(parsed[0], null, "the German count-share stays text without a lang");
  assert.deepEqual(parsed[2], { value: 1.5, unit: null, bound: false, range: null });
  assert.deepEqual(parsed[3], { value: 1234567, unit: null, bound: false, range: null });
});

test("a Spanish page stays dot-decimal because Spain and Mexico disagree", () => {
  const doc = render(PAGE, "es");
  const { lang, convention, parsed } = extractColumn(doc, 1);
  assert.equal(lang, "es");
  assert.equal(convention, "dot-decimal");
  assert.equal(parsed[0], null, "the German count-share stays text on a Spanish page");
  assert.deepEqual(parsed[2], { value: 1.5, unit: null, bound: false, range: null });
  assert.deepEqual(parsed[3], { value: 1234567, unit: null, bound: false, range: null });
});

test("language subtags and case map to the convention before parsing", () => {
  for (const [lang, expected] of [
    ["pt-BR", "comma-decimal"],
    ["TR", "comma-decimal"],
    ["de-DE", "comma-decimal"],
    ["en-GB", "dot-decimal"],
    ["es-MX", "dot-decimal"],
  ] as const) {
    const doc = render(PAGE, lang);
    assert.equal(conventionForLang(extractPage(doc).page.lang), expected, lang);
  }
});

test("the extractor parses numeric button text with the page's convention", () => {
  // holdsValue decides a button is part of the data by parsing its text. On a
  // German page a price button with a comma decimal must be kept, not dropped
  // as a control, so its text reaches the snapshot and the scale.
  const buttonTable = `
  <table>
    <thead><tr><th>Artikel</th><th>Preis</th></tr></thead>
    <tbody>
      <tr><td>A</td><td><button type="button">1.299,00 €</button></td></tr>
      <tr><td>B</td><td><button type="button">949,00 €</button></td></tr>
      <tr><td>C</td><td><button type="button">749,50 €</button></td></tr>
    </tbody>
  </table>`;
  const de = extractPage(render(buttonTable, "de")).tables[0]!.snapshot.rows.map((r) => r[1]);
  assert.deepEqual(de, ["1.299,00 €", "949,00 €", "749,50 €"], "German price buttons are kept as cell values");
  const en = extractPage(render(buttonTable, "en")).tables[0]!.snapshot.rows.map((r) => r[1]);
  // The same buttons do not parse as numbers under the English convention, so
  // they are treated as ordinary controls and stripped from the cell.
  assert.deepEqual(en, ["", "", ""], "the buttons are controls on an English page");
});

test("a German table extracted from a document profiles its columns as numeric", () => {
  // A column must be at least 80% numeric to profile as one, so this table
  // keeps one rejected cell among several convention-fitting ones.
  const table = `
  <table>
    <thead><tr><th>Name</th><th>Wert</th><th>Dauer</th></tr></thead>
    <tbody>
      <tr><td>A</td><td>22 (13,1%)</td><td>1544:10</td></tr>
      <tr><td>B</td><td>1.299,00 €</td><td>2:59</td></tr>
      <tr><td>C</td><td>891,12</td><td>0:57</td></tr>
      <tr><td>D</td><td>65.890</td><td>3:00</td></tr>
      <tr><td>E</td><td>1.5</td><td>1:02:03</td></tr>
    </tbody>
  </table>`;
  const doc = render(table, "de");
  const { page, tables } = extractPage(doc);
  const profiles = profileTable(tables[0]!.snapshot, conventionForLang(page.lang));
  const wert = profiles[1]!;
  assert.equal(wert.kind, "numeric");
  if (wert.kind === "numeric") {
    // Four convention-fitting cells enter the scale; the rejected "1.5" is null.
    assert.deepEqual(wert.values, [22, 1299, 891.12, 65890, null]);
    // Only the price carries a unit, so the column's modal unit is null.
    assert.equal(wert.unit, null);
    assert.deepEqual(parseNumber(tables[0]!.snapshot.rows[1]![1]!, conventionForLang(page.lang))?.unit, "€");
  }
  const dauer = profiles[2]!;
  assert.equal(dauer.kind, "numeric");
  if (dauer.kind === "numeric") {
    assert.deepEqual(dauer.values, [92650, 179, 57, 180, 3723]);
    assert.equal(dauer.unit, ":");
  }
});

test("the saved German fixture extracts and parses as a comma-decimal page", async () => {
  const html = await readFile(new URL("../fixtures/synthetic/locale-de.html", import.meta.url), "utf8");
  const dom = new JSDOM(html);
  const window = dom.window;
  globalThis.Node ??= window.Node;
  globalThis.HTMLElement ??= window.HTMLElement;
  globalThis.Element ??= window.Element;
  window.Element.prototype.checkVisibility = function (this: Element) {
    if (!this.isConnected) return false;
    const style = window.getComputedStyle(this);
    return style.display !== "none" && style.visibility !== "hidden" && !(this as HTMLElement).hidden;
  };
  const { page, tables } = extractPage(window.document);
  assert.equal(page.lang, "de");
  assert.equal(tables.length, 3);
  const convention: NumberConvention = conventionForLang(page.lang);
  assert.equal(convention, "comma-decimal");

  // Cities: dot thousands parse to the full counts, and density stays ordered across the thousands boundary.
  const cities = tables[0]!.snapshot;
  const residents = profileTable(cities, convention)[1]!;
  assert.equal(residents.kind, "numeric");
  if (residents.kind === "numeric") assert.deepEqual(residents.values, [764104, 625481, 248589, 99854, 65890, 31207]);

  // Prices: "1.299,00 €" is 1299 with unit €, and ratings such as "4,6" are decimals.
  const prices = profileTable(tables[1]!.snapshot, convention);
  const price = prices[1]!;
  assert.equal(price.kind, "numeric");
  if (price.kind === "numeric") {
    assert.deepEqual(price.values, [1299, 949, 1849.95, 749.5, 1049]);
    assert.equal(price.unit, "€");
  }
  const rating = prices[3]!;
  assert.equal(rating.kind, "numeric");
  if (rating.kind === "numeric") assert.deepEqual(rating.values, [4.6, 4.2, 4.8, 3.9, 4.4]);

  // Versions ("1.5") and US-style downloads ("1,204,318") break the German
  // convention, so neither column can be numeric: they stay text.
  const versions = profileTable(tables[2]!.snapshot, convention);
  assert.ok(
    versions.slice(1).every((p) => p.kind !== "numeric"),
    "non-conforming numbers stay text",
  );
});

test("extractTable defaults to the convention of its own document", () => {
  // The Svelte demo path calls extractTable directly; without an explicit
  // convention it still derives one from the table's document lang.
  const de = render(PAGE, "de");
  const table = de.getElementById("zahlen") as HTMLTableElement;
  const extracted = extractTable(table, "t0", []);
  assert.notEqual(extracted, null);
  const parsed = parseNumber(extracted!.snapshot.rows[1]![1]!, conventionForLang(de.documentElement.lang));
  assert.deepEqual(parsed, { value: 1299, unit: "€", bound: false, range: null });

  const en = render(PAGE, "en");
  const english = extractTable(en.getElementById("zahlen") as HTMLTableElement, "t0", []);
  assert.equal(parseNumber(english!.snapshot.rows[1]![1]!, conventionForLang(en.documentElement.lang)), null);
});
