import { test } from "node:test";
import assert from "node:assert/strict";

import BucketTool from "../src/editor/tools/toolset/bucket_tool.js";
import { UVMAP_CLASSIC, UVMAP_SLIM } from "../src/editor/model/uv.js";

const SIZE = 64;
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

/**
 * CanvasHelper stand-in for Node (no OffscreenCanvas available here).
 * It supports the same getPixel / putPixel / toTexture surface the bucket
 * tool uses for its cube fill styles.
 */
class FakeTexture {
  constructor() {
    this.canvas = { width: SIZE, height: SIZE };
    this.pixels = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => [...TRANSPARENT])
    );
  }

  getPixel({ x, y }) {
    const [r, g, b, a] = this.pixels[y][x];
    return {
      red: () => r,
      green: () => g,
      blue: () => b,
      alpha: () => a / 255,
    };
  }

  putPixel({ x, y }, color) {
    this.pixels[y][x] = [
      color.red(),
      color.green(),
      color.blue(),
      Math.round(color.alpha() * 255),
    ];
  }

  toTexture() {
    return { isTexture: true };
  }

  snapshot() {
    return this.pixels.map(row => row.map(px => [...px]));
  }
}

class StubConfig {
  constructor(fillStyle) {
    this.values = { fillStyle, bucketErase: false };
  }

  get(key, fallback) {
    return this.values[key] !== undefined ? this.values[key] : fallback;
  }

  set(key, value) {
    this.values[key] = value;
  }

  getColor() {
    const [r, g, b, a] = GREEN;
    return {
      red: () => r,
      green: () => g,
      blue: () => b,
      alpha: () => a / 255,
    };
  }
}

function makeToolData(texture, variant, point) {
  return {
    texture,
    getCoords: () => ({ x: point.x, y: point.y }),
    variant,
    button: 1,
  };
}

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

function rectOf(uvEntry) {
  let [x, y, w, h] = uvEntry;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, width: w, height: h };
}

function changedPoints(before, after) {
  const changed = new Set();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const a = before[y][x];
      const b = after[y][x];
      if (a.some((channel, i) => channel !== b[i])) {
        changed.add(`${x},${y}`);
      }
    }
  }
  return changed;
}

function facePointSet(rect) {
  const set = new Set();
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      set.add(`${x},${y}`);
    }
  }
  return set;
}

test("bucket fill-cube-connected (classic): only the clicked face region is repainted", () => {
  const texture = new FakeTexture();
  const front = rectOf(UVMAP_CLASSIC.arm_right_base_front); // [44,20,4,12]
  const left = rectOf(UVMAP_CLASSIC.arm_right_base_left);
  const right = rectOf(UVMAP_CLASSIC.arm_right_base_right);

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, left.x, left.y, left.width, left.height, RED);
  fillRect(texture, right.x, right.y, right.width, right.height, RED);
  // disconnected island inside the clicked face must survive a connected fill
  setPixel(texture, front.x + 2, front.y + 7, BLUE);

  const tool = new BucketTool(new StubConfig("fill-cube-connected"));
  const click = { x: front.x + 1, y: front.y + 2 };
  const before = texture.snapshot();

  const output = tool.down(makeToolData(texture, "classic", click));
  assert.deepEqual(output, { isTexture: true });

  const changed = changedPoints(before, texture.pixels);
  const expected = facePointSet(front);
  expected.delete(`${front.x + 2},${front.y + 7}`);
  assert.deepEqual(changed, expected);

  assert.deepEqual(texture.pixels[front.y + 7][front.x + 2], BLUE);
  for (const point of facePointSet(left)) {
    const [x, y] = point.split(",").map(Number);
    assert.deepEqual(texture.pixels[y][x], RED, `neighbouring part pixel ${point} must stay red`);
  }
  for (const point of facePointSet(right)) {
    const [x, y] = point.split(",").map(Number);
    assert.deepEqual(texture.pixels[y][x], RED);
  }
});

test("bucket fill-cube-replace (classic): whole face overwritten, neighbours untouched", () => {
  const texture = new FakeTexture();
  const front = rectOf(UVMAP_CLASSIC.torso_base_front); // [20,20,8,12]
  const back = rectOf(UVMAP_CLASSIC.torso_base_back);   // [32,20,8,12]

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, back.x, back.y, back.width, back.height, RED);
  setPixel(texture, front.x, front.y, BLUE);

  const tool = new BucketTool(new StubConfig("fill-cube-replace"));
  const click = { x: front.x + 4, y: front.y + 4 };
  const before = texture.snapshot();

  tool.down(makeToolData(texture, "classic", click));

  assert.deepEqual(changedPoints(before, texture.pixels), facePointSet(front));
  for (const point of facePointSet(back)) {
    const [x, y] = point.split(",").map(Number);
    assert.deepEqual(texture.pixels[y][x], RED);
  }
});

test("bucket cube styles (slim): 3px arm face never bleeds into the 4px neighbour", () => {
  const texture = new FakeTexture();
  const front = rectOf(UVMAP_SLIM.arm_right_base_front); // [44,20,3,12]
  const right = rectOf(UVMAP_SLIM.arm_right_base_right);  // [47,20,4,12]

  assert.equal(front.width, 3);
  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, right.x, right.y, right.width, right.height, RED);

  const tool = new BucketTool(new StubConfig("fill-cube-connected"));
  const click = { x: front.x + 2, y: front.y + 5 };
  const before = texture.snapshot();

  tool.down(makeToolData(texture, "slim", click));

  assert.deepEqual(changedPoints(before, texture.pixels), facePointSet(front));
  for (const point of facePointSet(right)) {
    const [x, y] = point.split(",").map(Number);
    assert.deepEqual(texture.pixels[y][x], RED);
  }
});

test("bucket cube styles: clicks outside the variant layout change nothing", () => {
  const outsideClicks = [
    { variant: "classic", fillStyle: "fill-cube-connected", point: { x: 0, y: 0 } },
    { variant: "classic", fillStyle: "fill-cube-replace", point: { x: 2, y: 2 } },
    { variant: "slim", fillStyle: "fill-cube-connected", point: { x: 57, y: 2 } },
    { variant: "slim", fillStyle: "fill-cube-replace", point: { x: 62, y: 62 } },
  ];

  for (const { variant, fillStyle, point } of outsideClicks) {
    const texture = new FakeTexture();
    fillRect(texture, 0, 0, SIZE, SIZE, RED);
    const before = texture.snapshot();

    const tool = new BucketTool(new StubConfig(fillStyle));
    tool.down(makeToolData(texture, variant, point));

    assert.deepEqual(texture.pixels, before, `${fillStyle} @${variant} ${point.x},${point.y} must not paint`);
  }
});

test("bucket cube erase: connected transparent fill stays within the face", () => {
  const texture = new FakeTexture();
  const front = rectOf(UVMAP_CLASSIC.arm_right_base_front);
  const left = rectOf(UVMAP_CLASSIC.arm_right_base_left);

  fillRect(texture, front.x, front.y, front.width, front.height, RED);
  fillRect(texture, left.x, left.y, left.width, left.height, RED);

  const config = new StubConfig("fill-cube-connected");
  config.set("bucketErase", true);
  const tool = new BucketTool(config);
  const before = texture.snapshot();

  tool.down(makeToolData(texture, "classic", { x: front.x, y: front.y }));

  const changed = changedPoints(before, texture.pixels);
  assert.deepEqual(changed, facePointSet(front));
  for (const point of facePointSet(left)) {
    const [x, y] = point.split(",").map(Number);
    assert.deepEqual(texture.pixels[y][x], RED);
  }
});
