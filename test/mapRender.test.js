/*
 * Functional check for the map.html data-handling script.
 *
 * Leaflet and the network are stubbed so the page's real inline script
 * runs against each data.json shape. We assert which municipalities get
 * markers and what the refresh/failure notice says.
 *
 * Run with: node --test test/mapRender.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function createElementStub(tagName) {
  return {
    tagName,
    className: "",
    innerHTML: "",
    textContent: "",
    children: [],
    attributes: {},
    style: {},
    appendChild(child) {
      this.children.push(child);
    },
    append(child) {
      this.children.push(child);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener() {}
  };
}

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
 * Build a fake Leaflet plus DOM and run map.html's second inline script.
 */
async function renderMap(data) {
  const markers = [];
  const mapElement = createElementStub("div");
  const mainElement = createElementStub("main");

  const LStub = {
    Map: function () {
      return {
        addLayer() {},
        addEventListener() {}
      };
    },
    TileLayer: function () {},
    DivIcon: function (options) {
      this.options = options;
    },
    Marker: function (latLng, options) {
      this.latLng = latLng;
      this.options = options;
      markers.push(this);
      this.bindPopup = () => this;
      this.openPopup = () => this;
    }
  };

  const documentStub = {
    addEventListener(event, handler) {
      if (event === "DOMContentLoaded") {
        this._readyHandler = handler;
      }
    },
    getElementById(id) {
      if (id === "map") {
        return mapElement;
      }
      return createElementStub("div");
    },
    querySelector(selector) {
      if (selector === "main") {
        return mainElement;
      }
      return createElementStub("div");
    },
    createElement: createElementStub
  };

  const windowStub = {
    innerWidth: 1200,
    L: LStub
  };

  const htmlPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "map.html"
  );
  const html = fs.readFileSync(htmlPath, "utf8");

  // The second inline <script> (without src) holds the map logic.
  const scripts = [
    ...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)
  ];
  const mapScript = scripts[1][1];

  const globals = {
    window: windowStub,
    document: documentStub,
    L: LStub,
    axios: {
      get: async () => ({ data })
    },
    Date,
    console: {
      log() {},
      warn() {},
      error() {}
    }
  };

  const runner = new Function(
    ...Object.keys(globals),
    `"use strict"; ${mapScript}`
  );

  runner(...Object.values(globals));
  documentStub._readyHandler();

  // Drain the axios promise chain.
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { markers, mapElement, mainElement };
}

const baseOrg = (overrides = {}) => ({
  handle: "cityssm",
  municipality: "City of Sault Ste. Marie",
  province: "Ontario",
  latitude: 46.5,
  longitude: -84.3,
  repositories: 1,
  stars: 1,
  ...overrides
});

describe("map.html rendering", () => {
  it("plots only successfully fetched cities and reports the failure count", async () => {
    const { markers, mainElement } = await renderMap({
      organizations: [
        baseOrg({ handle: "cityssm", stars: 120 }),
        baseOrg({
          handle: "cityofvancouver",
          municipality: "City of Vancouver",
          latitude: 49.28,
          longitude: -123.12,
          repositories: 0,
          stars: 0
        })
      ],
      failedOrganizations: [
        {
          handle: "CityofToronto",
          municipality: "City of Toronto",
          status: "failed",
          error: "404"
        },
        {
          handle: "cityofottawa",
          municipality: "City of Ottawa",
          status: "failed",
          error: "not an array"
        }
      ],
      refreshMillis: 1700000000000
    });

    assert.equal(markers.length, 2);
    const plotted = markers.map((marker) => marker.latLng);
    assert.deepEqual(plotted[0], [46.5, -84.3]);
    assert.deepEqual(plotted[1], [49.28, -123.12]);

    const notice = mainElement.children.find(
      (child) => child.className && child.className.includes("notification")
    );
    assert.ok(notice);
    const text = collectText(notice).join(" ");
    assert.ok(text.includes("Map shows 2 municipalities"));
    assert.ok(text.includes("2 municipalities were not mapped"));
    assert.ok(text.includes("Data Updated"));
  });

  it("shows a failure notice and no markers when every city failed", async () => {
    const { markers, mapElement, mainElement } = await renderMap({
      organizations: [],
      failedOrganizations: [
        { handle: "cityssm", municipality: "Sault Ste. Marie", error: "boom" }
      ],
      refreshMillis: 1700000000000
    });

    assert.equal(markers.length, 0);

    const danger = mapElement.children.find(
      (child) => child.className && child.className.includes("is-danger")
    );
    assert.ok(danger, "a danger notice replaces the empty map");
    assert.equal(danger.attributes.role, "alert");
    assert.ok(
      danger.innerHTML.includes("All municipality data fetches failed")
    );

    // The refresh information, including the failure count, is still shown.
    const notice = mainElement.children.find(
      (child) => child.className && child.className.includes("notification")
    );
    assert.ok(notice);
    const text = collectText(notice).join(" ");
    assert.ok(text.includes("Data Updated"));
    assert.ok(text.includes("1 municipality was not mapped"));
  });

  it("omits the failure sentence when nothing failed", async () => {
    const { markers, mainElement } = await renderMap({
      organizations: [
        baseOrg({ handle: "cityssm" }),
        baseOrg({
          handle: "cityofvancouver",
          latitude: 49.28,
          longitude: -123.12,
          repositories: 0,
          stars: 0
        })
      ],
      failedOrganizations: [],
      refreshMillis: 1700000000000
    });

    assert.equal(markers.length, 2);

    const notice = mainElement.children.find(
      (child) => child.className && child.className.includes("notification")
    );
    const text = collectText(notice).join(" ");
    assert.ok(text.includes("Map shows 2 municipalities"));
    assert.ok(!text.includes("not mapped"));
  });
});
