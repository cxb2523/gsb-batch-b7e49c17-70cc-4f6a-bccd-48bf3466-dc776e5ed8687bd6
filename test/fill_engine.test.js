import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getFaceRectAtPoint,
  computeCubeFaceFill,
} from "../src/editor/tools/fill_engine.js";
import { UVMAP_CLASSIC, UVMAP_SLIM } from "../src/editor/model/uv.js";

const SIZE = 64;
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const GREEN = [0, 255, 0, 255];
const TRANSPARENT = [0, 0, 0, 0];

/**
 * Minimal stand-in for CanvasHelper: a 64x64 RGBA grid exposing the two
 * methods the fill engine relies on. Each pixel is a plain [r,g,b,a] array
 * so color equality is simple and exact (the editor's own tolerance-based
 * colorsMatch is exercised in the BucketTool integration tests).
 */
class FakeTexture {
  constructor() {
    this.pixels = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => [...TRANSPARENT])
    );
  }

  getPixel({ x, y }) {
    return this.pixels[y][x];
  }

  putPixel({ x, y }, color) {
    this.pixels[y][x] = [...color];
  }

  snapshot() {
    return this.pixels.map(row => row.map(px => [...px]));
  }
}

const exactMatch = (a, b) =>
  a !== undefined &&
  b !== undefined &&
  a.length === b.length &&
  a.every((channel, i) => channel === b[i]);

function setPixel(texture, x, y, color) {
  texture.pixels[y][x] = [...color];
}

function fillRect(texture, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      setPixel(texture, px, py, color);
    }
  }
}

function changedPoints(before, after) {
  const changed = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!exactMatch(before[y][x], after[y][x])) {
        changed.push({ x, y });
      }
    }
  }
  return changed;
}

function keyOf(point) {
  return `${point.x},${point.y}`;
}

/**
 * Independent reference flood fill: plain recursive DFS over 4-neighbours,
 * clipped to a rectangle. This is intentionally written differently from
 * the BFS implementation under test so both cannot share a mistake.
 */
function referenceConnectedPoints(texture, start, rect) {
  const target = texture.getPixel(start);
  const seen = new Set();
  const result = [];

  function visit(x, y) {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) return;
    if (!exactMatch(texture.getPixel({ x, y }), target)) return;

    seen.add(key);
    result.push({ x, y });

    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  visit(start.x, start.y);
  return result;
}

function referenceReplacePoints(rect) {
  const result = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      result.push({ x, y });
    }
  }
  return result;
}

function asSet(points) {
  return new Set(points.map(keyOf));
}

function assertOnlyPointsChanged(before, after, expectedPoints) {
  const expected = asSet(expectedPoints);
  const changed = asSet(changedPoints(before, after));
  assert.deepEqual(changed, expected);
}

function rectOf(uvEntry) {
  let [x, y, w, h] = uvEntry;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Classic variant, connected fill
// ---------------------------------------------------------------------------

test("classic: connected fill stays inside the clicked 4px-wide arm face", () => {
  const texture = new FakeTexture();
  // classic right arm base front: [44, 20, 4, 12]
  const front = rectOf(UVMAP_CLASSIC.arm_right_base_front);
  // adjacent faces in the same cube strip: left [40,20,4,12], right [48,20,4,12]
  const left = rectOf(UVMAP_CLASSIC.arm_right_base_left);
  const right = rectOf(UVMAP_CLASSIC.arm_right_base_right);

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, left.x, left.y, left.width, left.height, RED);
  fillRect(texture, right.x, right.y, right.width, right.height, RED);
  // disconnected blue island inside the front face
  setPixel(texture, front.x + 1, front.y + 3, BLUE);
  setPixel(texture, front.x + 2, front.y + 3, BLUE);

  const click = { x: front.x, y: front.y };
  const before = texture.snapshot();
  const result = computeCubeFaceFill(texture, "classic", click, {
    colorsMatch: exactMatch,
    replace: false,
  });

  assert.ok(result);
  const expected = referenceConnectedPoints(texture, click, front);
  assert.deepEqual(asSet(result.points), asSet(expected));

  for (const point of result.points) {
    texture.putPixel(point, GREEN);
  }

  // Exactly the connected set changed; blue island and both neighbouring
  // faces (same red color, separated only by a UV seam) are untouched.
  assertOnlyPointsChanged(before, texture.pixels, expected);
  assert.deepEqual(texture.getPixel({ x: front.x + 1, y: front.y + 3 }), BLUE);
  for (const point of referenceReplacePoints(left).concat(referenceReplacePoints(right))) {
    assert.deepEqual(texture.getPixel(point), RED);
  }
});

test("classic: connected fill does not wrap across the front/top UV seam", () => {
  const texture = new FakeTexture();
  // classic head front [8,8,8,8], head top [8,0,8,8]: adjacent in the texture
  const front = rectOf(UVMAP_CLASSIC.head_base_front);
  const top = rectOf(UVMAP_CLASSIC.head_base_top);

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, top.x, top.y, top.width, top.height, RED);

  const click = { x: front.x + 2, y: front.y }; // pixel directly below the seam
  const before = texture.snapshot();
  const result = computeCubeFaceFill(texture, "classic", click, {
    colorsMatch: exactMatch,
    replace: false,
  });

  assert.ok(result);
  const expected = referenceConnectedPoints(texture, click, front);
  for (const point of result.points) {
    texture.putPixel(point, GREEN);
  }

  assertOnlyPointsChanged(before, texture.pixels, expected);
  for (const point of referenceReplacePoints(top)) {
    assert.deepEqual(texture.getPixel(point), RED);
  }
});

// ---------------------------------------------------------------------------
// Classic variant, replace fill
// ---------------------------------------------------------------------------

test("classic: replace fill overwrites the whole face but never crosses its border", () => {
  const texture = new FakeTexture();
  // classic left leg base front [20,52,4,12]
  const front = rectOf(UVMAP_CLASSIC.leg_left_base_front);
  const back = rectOf(UVMAP_CLASSIC.leg_left_base_back); // [28,52,4,12]

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, back.x, back.y, back.width, back.height, RED);
  // mixed colors inside the clicked face
  setPixel(texture, front.x, front.y, BLUE);
  setPixel(texture, front.x + 3, front.y + 11, TRANSPARENT);

  const click = { x: front.x + 2, y: front.y + 5 };
  const before = texture.snapshot();
  const result = computeCubeFaceFill(texture, "classic", click, {
    colorsMatch: exactMatch,
    replace: true,
  });

  assert.ok(result);
  const expected = referenceReplacePoints(front);
  assert.deepEqual(asSet(result.points), asSet(expected));

  for (const point of result.points) {
    texture.putPixel(point, GREEN);
  }

  assertOnlyPointsChanged(before, texture.pixels, expected);
  for (const point of referenceReplacePoints(back)) {
    assert.deepEqual(texture.getPixel(point), RED);
  }
});

// ---------------------------------------------------------------------------
// Slim variant, connected fill
// ---------------------------------------------------------------------------

test("slim: connected fill uses the real 3px-wide arm face", () => {
  const texture = new FakeTexture();
  // slim right arm base front: [44, 20, 3, 12]
  const front = rectOf(UVMAP_SLIM.arm_right_base_front);
  assert.equal(front.width, 3);
  const right = rectOf(UVMAP_SLIM.arm_right_base_right); // [47,20,4,12]
  const back = rectOf(UVMAP_SLIM.arm_right_base_back); // [51,20,3,12]

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, right.x, right.y, right.width, right.height, RED);
  fillRect(texture, back.x, back.y, back.width, back.height, RED);
  // barrier inside the front face splits it into two regions
  setPixel(texture, front.x + 1, front.y + 6, BLUE);

  const click = { x: front.x, y: front.y };
  const before = texture.snapshot();
  const result = computeCubeFaceFill(texture, "slim", click, {
    colorsMatch: exactMatch,
    replace: false,
  });

  assert.ok(result);
  const expected = referenceConnectedPoints(texture, click, front);
  for (const point of result.points) {
    texture.putPixel(point, GREEN);
  }

  assertOnlyPointsChanged(before, texture.pixels, expected);
  // the 4th UV column belongs to the slim arm's 4px-wide right face and
  // must stay untouched even though it sits immediately beside the click
  assert.deepEqual(texture.getPixel({ x: front.x + 3, y: front.y }), RED);
  assert.deepEqual(texture.getPixel({ x: front.x + 3, y: front.y + 11 }), RED);
  for (const point of referenceReplacePoints(back)) {
    assert.deepEqual(texture.getPixel(point), RED);
  }
});

test("slim vs classic: same click coordinates resolve to different face widths", () => {
  const click = { x: 46, y: 25 }; // inside both layouts' right arm front strip
  const classicRect = getFaceRectAtPoint("classic", click);
  const slimRect = getFaceRectAtPoint("slim", click);

  assert.equal(classicRect.width, 4);
  assert.equal(slimRect.width, 3);
  assert.equal(classicRect.x, slimRect.x);
});

test("slim: replace fill recolors every pixel of the 3px face only", () => {
  const texture = new FakeTexture();
  // slim left arm base front [36,52,3,12]
  const front = rectOf(UVMAP_SLIM.arm_left_base_front);
  const left = rectOf(UVMAP_SLIM.arm_left_base_left); // [32,52,4,12]

  fillRect(texture, front.x, front.y, front.width, front.height, BLUE);
  fillRect(texture, left.x, left.y, left.width, left.height, BLUE);

  const click = { x: front.x + 1, y: front.y + 10 };
  const before = texture.snapshot();
  const result = computeCubeFaceFill(texture, "slim", click, {
    colorsMatch: exactMatch,
    replace: true,
  });

  assert.ok(result);
  const expected = referenceReplacePoints(front);
  for (const point of result.points) {
    texture.putPixel(point, GREEN);
  }

  assertOnlyPointsChanged(before, texture.pixels, expected);
  for (const point of referenceReplacePoints(left)) {
    assert.deepEqual(texture.getPixel(point), BLUE);
  }
});

// ---------------------------------------------------------------------------
// Clicks outside every face of the variant layout
// ---------------------------------------------------------------------------

test("out-of-layout clicks return null and change nothing (connected)", () => {
  const outsideClicks = [
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { x: 57, y: 2 },
    { x: 58, y: 30 },
  ];

  for (const click of outsideClicks) {
    const texture = new FakeTexture();
    fillRect(texture, 0, 0, SIZE, SIZE, RED);
    const before = texture.snapshot();

    const result = computeCubeFaceFill(texture, "classic", click, {
      colorsMatch: exactMatch,
      replace: false,
    });

    assert.equal(result, null, `expected no face at ${keyOf(click)}`);
    assert.deepEqual(texture.pixels, before);
  }
});

test("out-of-layout clicks return null and change nothing (replace)", () => {
  const outsideClicks = [
    { x: 2, y: 2 },
    { x: 57, y: 2 },
    // x=62 is used by the classic arm overlay but unused in the slim layout
    { x: 62, y: 62 },
  ];

  for (const click of outsideClicks) {
    const texture = new FakeTexture();
    fillRect(texture, 0, 0, SIZE, SIZE, RED);
    const before = texture.snapshot();

    const result = computeCubeFaceFill(texture, "slim", click, {
      colorsMatch: exactMatch,
      replace: true,
    });

    assert.equal(result, null, `expected no face at ${keyOf(click)}`);
    assert.deepEqual(texture.pixels, before);
  }
});

test("unknown variant returns null", () => {
  const texture = new FakeTexture();
  assert.equal(
    computeCubeFaceFill(texture, "wide", { x: 10, y: 10 }, { colorsMatch: exactMatch }),
    null
  );
});
