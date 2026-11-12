/*
 * Lightweight functional check for the inline index.html rendering script.
 *
 * No browser or extra dependencies: a minimal DOM stub plus an axios stub
 * let the page's real inline script run against each data.json shape
 * (partial failure, all failure, zero repositories).
 *
 * Run with: node test/pageRender.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimal DOM element stub supporting only what the page script uses.
 */
function createElementStub(tagName) {
  return {
    tagName,
    className: "",
    innerHTML: "",
    textContent: "",
    children: [],
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(child) {
      this.children.push(child);
    },
    querySelector() {
      return createElementStub("tbody");
    }
  };
}

/**
 * Collect every text node produced by the rendered tree.
 */
function collectText(element, texts = []) {
  if (element.textContent) {
    texts.push(element.textContent);
  }
  if (element.innerHTML && element.children.length === 0) {
    texts.push(element.innerHTML);
  }
  for (const child of element.children) {
    collectText(child, texts);
  }
  return texts;
}

/**
 * Build the globals the inline script expects and execute it.
 */
async function renderPage(data) {
  const container = createElementStub("div");

  const documentStub = {
    querySelector(selector) {
      if (selector === "#table-container") {
        return container;
      }
      return createElementStub("div");
    },
    createElement: createElementStub
  };

  const globals = {
    document: documentStub,
    axios: {
      get: async () => ({ data })
    },
    Date,
    console
  };

  const htmlPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "index.html"
  );
  const html = fs.readFileSync(htmlPath, "utf8");

  const inlineScript = html.match(
    /<script>\s*function escapeHtml[\s\S]*?<\/script>/
  )[0]
    .replace(/^<script>/, "")
    .replace(/<\/script>$/, "");

  const runner = new Function(
    ...Object.keys(globals),
    `"use strict"; ${inlineScript}`
  );

  // The axios promise chain is async; let it drain.
  await runner(...Object.values(globals));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return container;
}

const baseOrg = (overrides = {}) => ({
  handle: "cityssm",
  municipality: "City of Sault Ste. Marie",
  province: "Ontario",
  latitude: 46.5,
  longitude: -84.3,
  followers: 1,
  repositories: 1,
  stars: 1,
  forks: 0,
  issues: 0,
  lastUpdate: "",
  languages: {},
  status: "success",
  ...overrides
});

describe("index.html rendering", () => {
  it("lists failed municipalities below the table and keeps zero-repo cities out of that list", async () => {
    const container = await renderPage({
      organizations: [
        baseOrg({ handle: "cityssm", stars: 5, repositories: 2 }),
        baseOrg({
          handle: "cityofvancouver",
          municipality: "City of Vancouver",
          province: "British Columbia",
          repositories: 0,
          stars: 0
        })
      ],
      failedOrganizations: [
        {
          handle: "CityofToronto",
          municipality: "City of Toronto",
          province: "Ontario",
          status: "failed",
          error: "404 Not Found"
        }
      ],
      refreshMillis: 1700000000000
    });

    const table = container.children.find((child) => child.tagName === "table");
    assert.ok(table, "the ranking table is rendered");

    // Two rows for the two successful cities.
    const tbody = table.querySelector("tbody");
    assert.ok(tbody);

    const failureNotice = container.children.find(
      (child) => child.className && child.className.includes("is-warning")
    );
    assert.ok(failureNotice, "a failure notice is rendered below the table");
    assert.ok(failureNotice.innerHTML.includes("1 municipality"));
    assert.ok(failureNotice.innerHTML.includes("City of Toronto"));
    assert.ok(failureNotice.innerHTML.includes("CityofToronto"));
    assert.ok(failureNotice.innerHTML.includes("404 Not Found"));

    // The zero-repository city must not appear in the failure list.
    assert.ok(!failureNotice.innerHTML.includes("Vancouver"));

    // The refresh timestamp is still shown.
    const allText = collectText(container).join(" ");
    assert.ok(allText.includes("Last Updated"));
  });

  it("shows a prominent failure notice instead of a table when every city failed", async () => {
    const container = await renderPage({
      organizations: [],
      failedOrganizations: [
        {
          handle: "cityssm",
          municipality: "City of Sault Ste. Marie",
          status: "failed",
          error: "boom"
        },
        {
          handle: "CityofToronto",
          municipality: "City of Toronto",
          status: "failed",
          error: "also boom"
        }
      ],
      refreshMillis: 1700000000000
    });

    const table = container.children.find((child) => child.tagName === "table");
    assert.ok(!table, "no table is rendered on total failure");

    const danger = container.children.find(
      (child) => child.className && child.className.includes("is-danger")
    );
    assert.ok(danger, "a prominent danger notice is rendered");
    assert.equal(danger.attributes.role, "alert");
    assert.ok(danger.innerHTML.includes("All municipality data fetches failed"));
    assert.ok(danger.innerHTML.includes("City of Toronto"));
    assert.ok(danger.innerHTML.includes("boom"));

    // The refresh timestamp is still surfaced alongside the failure notice.
    const allText = collectText(container).join(" ");
    assert.ok(allText.includes("Last Updated"));
  });

  it("renders an ordinary table with no failure section when nothing failed", async () => {
    const container = await renderPage({
      organizations: [
        baseOrg({ handle: "cityofvancouver", repositories: 0, stars: 0 })
      ],
      failedOrganizations: [],
      refreshMillis: 1700000000000
    });

    assert.ok(
      container.children.some((child) => child.tagName === "table")
    );
    assert.ok(
      !collectText(container).join(" ").includes("could not be fetched")
    );
  });
});
